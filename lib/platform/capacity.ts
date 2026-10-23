import { createHash } from "node:crypto";
import {
  AggregateField, FieldValue, Timestamp,
  type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction,
} from "firebase-admin/firestore";
import { canonicalPlanId, readPlatformState, subscriptionPlans, validateManagedPlan } from "@/lib/platform/engine";
import type { PlanLimits } from "@/lib/platform/models";

export type InstitutionCapacityLimit = keyof PlanLimits;

const countCollections: Partial<Record<InstitutionCapacityLimit, string>> = {
  maxUsers: "users",
  maxDepartments: "departments",
  maxMonthlyNotifications: "notifications",
  maxIntegrationEndpoints: "integrations",
};

function currentPeriod(limit: InstitutionCapacityLimit, now: Date) {
  return limit === "maxMonthlyNotifications" ? now.toISOString().slice(0, 7) : "all-time";
}

function counterDocumentId(institutionId: string, limit: InstitutionCapacityLimit, period: string) {
  return createHash("sha256").update(`${institutionId}:${limit}:${period}`).digest("hex");
}

async function initialUsage(
  db: Firestore,
  institutionId: string,
  limit: InstitutionCapacityLimit,
  now: Date,
): Promise<number> {
  if (limit === "maxStorageMb") {
    const query = db.collection("documents").where("institutionId", "==", institutionId);
    const result = await query.aggregate({ bytes: AggregateField.sum("size") }).get();
    return Number(result.data().bytes ?? 0);
  }
  const collectionName = countCollections[limit];
  if (!collectionName) throw new Error(`Unsupported institution capacity limit: ${limit}`);
  let query = db.collection(collectionName).where("institutionId", "==", institutionId);
  if (limit === "maxMonthlyNotifications") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    query = query.where("createdAt", ">=", Timestamp.fromDate(start));
  }
  const result = await query.count().get();
  return result.data().count;
}

export async function withInstitutionCapacity<T>(input: {
  db: Firestore;
  institutionId: string;
  limit: InstitutionCapacityLimit;
  amount: number;
  now?: Date;
  readRefs?: Array<DocumentReference>;
  idempotencyRef?: DocumentReference;
  write: (transaction: Transaction, reads: DocumentSnapshot[]) => T | Promise<T>;
  duplicate?: (snapshot: DocumentSnapshot) => T;
}): Promise<T> {
  const { db, institutionId, limit, amount, write } = input;
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Capacity consumption must be a positive safe integer.");
  const now = input.now ?? new Date();
  const period = currentPeriod(limit, now);
  const institutionRef = db.collection("institutions").doc(institutionId);
  const institutionSnapshot = await institutionRef.get();
  if (!institutionSnapshot.exists) throw new Error("FORBIDDEN");
  const planId = canonicalPlanId(institutionSnapshot.get("planTier") ?? institutionSnapshot.get("subscription.planId"));
  const planRef = db.collection("platformPlanCatalog").doc(planId);
  const counterRef = db.collection("institutionCapacity").doc(counterDocumentId(institutionId, limit, period));
  const counterSnapshot = await counterRef.get();
  const seedUsage = counterSnapshot.exists
    ? Number(counterSnapshot.get("usage") ?? 0)
    : await initialUsage(db, institutionId, limit, now);
  if (!Number.isSafeInteger(seedUsage) || seedUsage < 0) throw new Error("Institution capacity usage is invalid.");

  return db.runTransaction(async (transaction) => {
    const refs = [institutionRef, planRef, counterRef, ...(input.idempotencyRef ? [input.idempotencyRef] : []), ...(input.readRefs ?? [])];
    const snapshots = await transaction.getAll(...refs);
    const currentInstitution = snapshots[0];
    const currentPlan = snapshots[1];
    const currentCounter = snapshots[2];
    if (!currentInstitution.exists) throw new Error("FORBIDDEN");
    const currentPlanId = canonicalPlanId(currentInstitution.get("planTier") ?? currentInstitution.get("subscription.planId"));
    if (currentPlanId !== planId) throw new Error("Institution plan changed; retry the operation.");
    const seedPlan = subscriptionPlans.find((plan) => plan.planId === planId);
    if (!seedPlan) throw new Error("Institution subscription plan is unavailable.");
    const plan = currentPlan.exists
      ? validateManagedPlan({ ...currentPlan.data(), planId: currentPlan.id }, planId)
      : seedPlan;
    const state = readPlatformState(institutionId, currentInstitution.data() ?? {}, { tenantModules: [], plans: [plan] }, now.toISOString());
    if (state.status !== "active") throw new Error("FORBIDDEN");

    const idempotencyIndex = input.idempotencyRef ? 3 : -1;
    const idempotencySnapshot = idempotencyIndex >= 0 ? snapshots[idempotencyIndex] : undefined;
    if (idempotencySnapshot?.exists) {
      if (!input.duplicate) throw new Error("DUPLICATE_RESOURCE");
      return input.duplicate(idempotencySnapshot);
    }

    const allowed = state.entitlement.limits[limit];
    const usage = currentCounter.exists && currentCounter.get("period") === period
      ? Number(currentCounter.get("usage") ?? 0)
      : seedUsage;
    if (!Number.isSafeInteger(usage) || usage < 0) throw new Error("Institution capacity usage is invalid.");
    const exceedsLimit = limit === "maxStorageMb"
      ? Math.ceil((usage + amount) / (1024 * 1024)) > allowed
      : usage + amount > allowed;
    if (allowed !== -1 && exceedsLimit) {
      throw new Error(`PLAN_LIMIT_EXCEEDED:${limit}:${allowed}`);
    }

    const additionalReads = snapshots.slice(3 + (input.idempotencyRef ? 1 : 0));
    const result = await write(transaction, additionalReads);
    transaction.set(counterRef, {
      institutionId,
      limit,
      period,
      usage: usage + amount,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (limit === "maxStorageMb") {
      transaction.set(institutionRef, { storageBytes: FieldValue.increment(amount) }, { merge: true });
    }
    return result;
  });
}
