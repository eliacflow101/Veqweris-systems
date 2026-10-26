import { AggregateField, FieldPath, FieldValue, type Query, type Transaction } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { NextResponse } from "next/server";
import { navigationConfig } from "@/lib/navigation";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { createAuditEvent } from "@/lib/governance";
import { networkTrustStates } from "@/lib/network";
import {
  applySupportScopeRedaction, assertPlanMigrationAllowed, assignPlan, assignRelationship, buildInstitutionAdministrationView,
  canAccessInstitution, createSupportGrant, defaultPlatformState, institutionRelationships,
  institutionSummary, isActivePlatformOperator, isSupportGrantActive, canPlatform, planFeatureKeys,
  platformCapabilities, platformDashboardStats, platformRoles, readPlatformState,
  requirePlatformCapability, revokeSupportGrant, scopeAllows, supportScopes,
  tenantModuleCatalogue, updateBillingOverride, updateEntitlementOverrides, updateInstitutionStatus,
  updatePolicies, updateSecurityState, validateFeatureSelection, validateManagedPlan, validateModuleSelection,
} from "@/lib/platform";
import { loadManagedPlanCatalog } from "@/lib/platform/managed-catalog";
import type { SubscriptionPlan } from "@/lib/platform";
import type {
  InstitutionUsageSnapshot, MonitoringSignal, PlatformAuditEvent, PlatformOperator,
  SupportAccessGrant, SupportScope,
} from "@/lib/platform";
import { monitoringDomains } from "@/lib/platform/models";

const PLATFORM_AUDIT_SCOPE = "platform";
const tenantModules = tenantModuleCatalogue(navigationConfig);
function contextWithPlans(plans: SubscriptionPlan[]) {
  return { tenantModules, plans };
}

type PlatformActor = { decoded: DecodedIdToken; operator: PlatformOperator };

async function authenticate(request: Request): Promise<PlatformActor> {
  if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
  const token = await getSessionToken(request);
  if (!token) throw new Error("UNAUTHENTICATED");
  const decoded = await verifyActiveSession(token);
  const snapshot = await adminDb.collection("platformOperators").doc(decoded.uid).get();
  const operator = snapshot.exists ? (snapshot.data() as PlatformOperator) : null;
  // Institution roles live on `users` and are deliberately never consulted here.
  if (!isActivePlatformOperator(operator)) throw new Error("FORBIDDEN");
  return { decoded, operator };
}

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "SERVICE_UNAVAILABLE") return NextResponse.json({ error: "Platform service is unavailable." }, { status: 503 });
  if (code === "UNAUTHENTICATED") return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (code === "FORBIDDEN") return NextResponse.json({ error: "Platform operator access required." }, { status: 403 });
  if (code === "PLAN_MIGRATION_NOT_ALLOWED") return NextResponse.json({ error: "The managed plan catalog does not allow this migration." }, { status: 409 });
  if (code === "PLAN_CATALOG_CHANGED") return NextResponse.json({ error: "The managed plan catalog changed; reload and retry." }, { status: 409 });
  if (code === "PLAN_INACTIVE") return NextResponse.json({ error: "Only active catalog plans may be assigned." }, { status: 400 });
  if (code === "MONITORING_SIGNAL_LIMIT") return NextResponse.json({ error: "The institution has reached its daily monitoring-entry limit." }, { status: 429 });
  console.error("Platform administration request failed.", error);
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process platform request." }, { status: 400 });
}

async function loadGrants(institutionId?: string, operatorUid?: string) {
  if (!adminDb) return [] as SupportAccessGrant[];
  let base: Query = adminDb.collection("platformSupportGrants");
  if (institutionId) base = base.where("institutionId", "==", institutionId);
  if (operatorUid) base = base.where("operatorUid", "==", operatorUid);
  const snapshot = await base.limit(500).get();
  return snapshot.docs.map((doc) => doc.data() as SupportAccessGrant);
}

/**
 * Every platform action is appended to the platform audit trail, and institution
 * actions are mirrored into that institution's own audit trail so platform
 * changes are never invisible to the tenant.
 */
async function audit(
  actor: PlatformActor,
  action: string,
  targetInstitutionId: string | null,
  payload: Record<string, unknown>,
  resourceType = "institution",
  resourceId = targetInstitutionId ?? PLATFORM_AUDIT_SCOPE,
  platformState?: ReturnType<typeof readPlatformState>,
  writeAdditional?: (transaction: Transaction) => Promise<void>,
  expectedInstitution?: Record<string, unknown>,
) {
  if (!adminDb) return null;
  const headRef = adminDb.collection("platformMetadata").doc("auditHead");
  return adminDb.runTransaction(async (transaction) => {
    const headSnapshot = await transaction.get(headRef);
    const previousHash = headSnapshot.exists ? String(headSnapshot.get("hash") ?? "") : null;
    const sequence = headSnapshot.exists ? Number(headSnapshot.get("sequence") ?? -1) + 1 : 0;
    const occurredAt = new Date().toISOString();
    const event = createAuditEvent({
      eventId: `platform_${sequence}_${resourceType}_${resourceId}_${Date.now()}`,
      institutionId: targetInstitutionId ?? PLATFORM_AUDIT_SCOPE,
      actorUid: actor.operator.uid,
      action,
      resourceType,
      resourceId,
      payload,
      occurredAt,
      previousHash,
      sequence,
    });
    const record = {
      ...event,
      scope: PLATFORM_AUDIT_SCOPE,
      actorEmail: actor.operator.email ?? null,
      actorPlatformRole: actor.operator.platformRole,
      targetInstitutionId,
      createdAt: FieldValue.serverTimestamp(),
    };
    if (platformState && targetInstitutionId) {
      const institutionRef = adminDb!.collection("institutions").doc(targetInstitutionId);
      const currentInstitution = await transaction.get(institutionRef);
      if (!currentInstitution.exists) throw new Error("Institution no longer exists.");
      if (expectedInstitution) {
        const versionFields = [
          "status", "relationship", "planTier", "subscription", "entitlement", "policies",
          "securityState", "billingState", "platformUpdatedAt", "platformUpdatedBy",
        ];
        const changed = versionFields.some((field) =>
          JSON.stringify(currentInstitution.get(field) ?? null) !== JSON.stringify(expectedInstitution[field] ?? null));
        if (changed) throw new Error("Institution platform state changed; reload and retry.");
      }
    }
    if (writeAdditional) await writeAdditional(transaction);
    if (platformState && targetInstitutionId) {
      transaction.set(adminDb!.collection("institutions").doc(targetInstitutionId), {
        status: platformState.status,
        relationship: platformState.relationship,
        planTier: platformState.planTier,
        subscription: platformState.subscription,
        entitlement: platformState.entitlement,
        policies: platformState.policies,
        securityState: platformState.securityState,
        billingState: platformState.billingState,
        platformUpdatedAt: platformState.platformUpdatedAt ?? occurredAt,
        platformUpdatedBy: platformState.platformUpdatedBy ?? actor.operator.uid,
      }, { merge: true });
    }
    transaction.create(adminDb!.collection("platformAuditEvents").doc(event.eventId), record);
    transaction.set(headRef, { sequence, hash: event.hash, updatedAt: FieldValue.serverTimestamp() });
    if (targetInstitutionId) {
      transaction.create(adminDb!.collection("auditEvents").doc(event.eventId), { ...event, createdAt: FieldValue.serverTimestamp() });
    }
    return record;
  });
}

async function countQuery(
  collectionName: string,
  institutionId: string,
  extra: Array<[string, string]> = [],
  unavailable: string[] = [],
): Promise<number | null> {
  if (!adminDb) {
    unavailable.push(collectionName);
    return null;
  }
  try {
    let query: Query = adminDb.collection(collectionName).where("institutionId", "==", institutionId);
    for (const [field, value] of extra) query = query.where(field, "==", value);
    const snapshot = await query.count().get();
    return snapshot.data().count;
  } catch (reason) {
    console.error(`Unable to aggregate ${collectionName}.`, reason);
    unavailable.push(collectionName);
    return null;
  }
}

async function storageBytesQuery(institutionId: string, unavailable: string[]): Promise<number | null> {
  if (!adminDb) {
    unavailable.push("documents.size");
    return null;
  }
  try {
    const base = adminDb.collection("documents").where("institutionId", "==", institutionId);
    const [total, sized] = await Promise.all([
      base.count().get(),
      base.where("size", ">=", 0).aggregate({ bytes: AggregateField.sum("size"), count: AggregateField.count() }).get(),
    ]);
    if (sized.data().count !== total.data().count) {
      unavailable.push("documents.size");
      return null;
    }
    return Number(sized.data().bytes ?? 0);
  } catch (reason) {
    console.error("Unable to aggregate document storage usage.", reason);
    unavailable.push("documents.size");
    return null;
  }
}

/** Aggregates only. No tenant document content is ever read into a platform view. */
async function collectUsage(institutionId: string): Promise<InstitutionUsageSnapshot> {
  const unavailable: string[] = [];
  const [users, activeUsers, departments, documents, storageBytes, tasks, notifications, payments, auditEvents, securityEvents, imports, integrationExceptions, integrations] = await Promise.all([
    countQuery("users", institutionId, [], unavailable),
    countQuery("users", institutionId, [["status", "active"]], unavailable),
    countQuery("departments", institutionId, [], unavailable),
    countQuery("documents", institutionId, [], unavailable),
    storageBytesQuery(institutionId, unavailable),
    countQuery("tasks", institutionId, [], unavailable),
    countQuery("notifications", institutionId, [], unavailable),
    countQuery("payments", institutionId, [], unavailable),
    countQuery("auditEvents", institutionId, [], unavailable),
    countQuery("securityEvents", institutionId, [], unavailable),
    countQuery("bulkImportBatches", institutionId, [], unavailable),
    countQuery("integrationExceptions", institutionId, [["status", "open"]], unavailable),
    countQuery("integrations", institutionId, [], unavailable),
  ]);
  return {
    institutionId, users, activeUsers, departments, documents, storageBytes, tasks, notifications,
    payments, auditEvents, securityEvents, imports, integrationExceptions, integrations,
    generatedAt: new Date().toISOString(), unavailable,
  };
}

async function loadInstitutionDocument(institutionId: string) {
  if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
  const snapshot = await adminDb.collection("institutions").doc(institutionId).get();
  if (!snapshot.exists) throw new Error(`Institution ${institutionId} was not found.`);
  return snapshot.data() as Record<string, unknown>;
}

async function loadSignals(institutionId: string) {
  if (!adminDb) return [] as MonitoringSignal[];
  const snapshot = await adminDb.collection("platformMonitoringSignals")
    .where("institutionId", "==", institutionId)
    .orderBy("capturedAt", "desc")
    .limit(200)
    .get();
  return snapshot.docs.map((doc) => doc.data() as MonitoringSignal);
}

export async function GET(request: Request) {
  try {
    const { operator } = await authenticate(request);
    const plans = await loadManagedPlanCatalog(adminDb!, operator.uid);
    const context = contextWithPlans(plans);
    const params = new URL(request.url).searchParams;
    const institutionId = params.get("institutionId")?.trim();

    if (params.get("operators") === "1") {
      requirePlatformCapability(operator.platformRole, "operators.manage");
      const snapshot = await adminDb!.collection("platformOperators").orderBy(FieldPath.documentId()).limit(200).get();
      const operators = snapshot.docs
        .map((doc) => doc.data() as PlatformOperator)
        .sort((a, b) => a.platformRole.localeCompare(b.platformRole) || a.uid.localeCompare(b.uid));
      return NextResponse.json({ operators, platformRoles, capabilities: platformCapabilities });
    }

    if (params.get("audit") === "1") {
      requirePlatformCapability(operator.platformRole, "audit.view");
      const scope = params.get("scope") ?? PLATFORM_AUDIT_SCOPE;
      if (operator.platformRole === "Platform Support") {
        const targetId = params.get("institutionId")?.trim();
        if (!targetId) return NextResponse.json({ error: "Support audit access must be institution-scoped." }, { status: 400 });
        const grants = await loadGrants(targetId, operator.uid);
        const grant = grants.find((candidate) => isSupportGrantActive(candidate, undefined, targetId) && scopeAllows(candidate, "audit.view"));
        if (!grant) return NextResponse.json({ error: "An active audit.view support grant is required." }, { status: 403 });
      }
      const base = adminDb!.collection("platformAuditEvents");
      const snapshot = operator.platformRole !== "Platform Support" && scope === "all"
        ? await base.orderBy("sequence", "desc").limit(200).get()
        : await base.where("targetInstitutionId", "==", institutionId ?? scope).limit(200).get();
      const events = snapshot.docs
        .map((doc) => doc.data() as PlatformAuditEvent)
        .sort((a, b) => b.sequence - a.sequence);
      return NextResponse.json({ events });
    }

    if (institutionId) {
      const institution = await loadInstitutionDocument(institutionId);
      const grants = await loadGrants(institutionId, operator.platformRole === "Platform Support" ? operator.uid : undefined);
      if (operator.platformRole === "Platform Support"
        && !grants.some((grant) => grant.operatorUid === operator.uid
          && isSupportGrantActive(grant, undefined, institutionId)
          && scopeAllows(grant, "institution.overview"))) {
        return NextResponse.json({ error: "An active institution.overview support scope is required." }, { status: 403 });
      }
      if (!canAccessInstitution({ operator, institutionId, grants })) {
        return NextResponse.json({ error: "This institution is outside your authorized platform scope." }, { status: 403 });
      }
      const state = readPlatformState(institutionId, institution, context);
      const supportGrant = grants.find((grant) => grant.operatorUid === operator.uid && isSupportGrantActive(grant, undefined, institutionId));
      const needsScope = operator.platformRole === "Platform Support" || Boolean(params.get("scopeSafe"));
      if (needsScope && !supportGrant) {
        return NextResponse.json({ error: "Support access to this institution requires an explicit, unexpired grant." }, { status: 403 });
      }
      const allowUsage = !supportGrant || scopeAllows(supportGrant, "usage.view");
      const allowBilling = !supportGrant || scopeAllows(supportGrant, "billing.view");
      const allowSecurity = !supportGrant || scopeAllows(supportGrant, "security.view");
      const allowAudit = !supportGrant || scopeAllows(supportGrant, "audit.view");
      const usage = allowUsage ? await collectUsage(institutionId) : null;
      const signals = allowUsage ? await loadSignals(institutionId) : [];
      const view = buildInstitutionAdministrationView({ state, institution, usage, signals, grants, plans });
      const networkProfile = await adminDb!.collection("networkProfiles").doc(institutionId).get();
      view.networkTrustState = networkProfile.exists
        ? networkProfile.get("platformTrustState") ?? "Registered"
        : "Registered";
      if (supportGrant) {
        return NextResponse.json({ ...applySupportScopeRedaction(view, supportGrant), supportAccess: { grantId: supportGrant.grantId, scopes: supportGrant.scopes, expiresAt: supportGrant.expiresAt, readOnly: true } });
      }
      return NextResponse.json({ view });
    }

    // Dashboard: tenant-safe summaries plus console statistics.
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(params.get("limit") ?? "25", 10) || 25));
    const cursor = params.get("cursor");
    if (cursor && (cursor.length > 512 || /[\u0000-\u001f]/.test(cursor))) {
      return NextResponse.json({ error: "Invalid institution directory cursor." }, { status: 400 });
    }
    let institutionQuery: Query = adminDb!.collection("institutions").orderBy(FieldPath.documentId()).limit(pageSize + 1);
    if (cursor) institutionQuery = institutionQuery.startAfter(cursor);
    const institutionsSnapshot = await institutionQuery.get();
    const hasMore = institutionsSnapshot.docs.length > pageSize;
    const pageDocs = institutionsSnapshot.docs.slice(0, pageSize);
    const grants = operator.platformRole === "Platform Support" ? await loadGrants(undefined, operator.uid) : [];
    const summaries = pageDocs
      .map((doc) => ({ institutionId: doc.id, data: doc.data() as Record<string, unknown> }))
      .filter((entry) => canAccessInstitution({ operator, institutionId: entry.institutionId, grants }))
      .map((entry) => institutionSummary(readPlatformState(entry.institutionId, entry.data, context), entry.data, plans));
    const nextCursor = hasMore ? pageDocs[pageDocs.length - 1]?.id ?? null : null;
    return NextResponse.json({
      institutions: summaries,
      statistics: platformDashboardStats(summaries),
      plans: plans.slice().sort((left, right) => left.planId.localeCompare(right.planId)),
      directory: { nextCursor, pageSize, pageCount: summaries.length },
      relationships: institutionRelationships,
      supportScopes,
      platformModules: tenantModules,
      featureKeys: planFeatureKeys,
      operator: { uid: operator.uid, email: operator.email, platformRole: operator.platformRole, displayName: operator.displayName },
      supportOperators: canPlatform(operator.platformRole, "support.grant")
        ? (await adminDb!.collection("platformOperators")
          .where("platformRole", "==", "Platform Support")
          .where("status", "==", "active")
          .limit(100)
          .get()).docs.map((doc) => ({ uid: doc.id, email: String(doc.get("email") ?? ""), displayName: String(doc.get("displayName") ?? "") }))
        : [],
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticate(request);
    const { operator } = actor;
    const plans = await loadManagedPlanCatalog(adminDb!, operator.uid);
    const context = contextWithPlans(plans);
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const institutionId = typeof body.institutionId === "string" ? body.institutionId.trim() : "";

    if (action === "update_plan_catalog") {
      requirePlatformCapability(operator.platformRole, "plans.manage");
      const plan = validateManagedPlan(body.plan);
      const planRef = adminDb!.collection("platformPlanCatalog").doc(plan.planId);
      const institutionCollection = adminDb!.collection("institutions");
      const previous = plans.find((entry) => entry.planId === plan.planId)!;
      await audit(actor, "plan.catalog.updated", null, {
        planId: plan.planId, previous, updated: plan, seededDefaults: true,
      }, "subscriptionPlan", plan.planId, undefined, async (transaction) => {
        const catalogRefs = plans.map((entry) => adminDb!.collection("platformPlanCatalog").doc(entry.planId));
        const catalogSnapshots = await transaction.getAll(...catalogRefs);
        const currentPlan = catalogSnapshots.find((snapshot) => snapshot.ref.path === planRef.path);
        const legacyAssignments = await transaction.get(institutionCollection.where("planTier", "==", plan.planId).limit(1));
        const subscriptionAssignments = await transaction.get(institutionCollection.where("subscription.planId", "==", plan.planId).limit(1));
        if (plan.status === "deprecated" && previous.status !== "deprecated"
          && (!legacyAssignments.empty || !subscriptionAssignments.empty)) {
          throw new Error("A plan assigned to an institution cannot be deprecated until those institutions are safely migrated.");
        }
        catalogSnapshots.forEach((snapshot, index) => {
          if (!snapshot.exists) {
            const seed = plans[index];
            transaction.create(catalogRefs[index], { ...seed, updatedAt: FieldValue.serverTimestamp(), updatedBy: operator.uid });
          } else {
            validateManagedPlan({ ...snapshot.data(), planId: snapshot.id }, plans[index].planId);
          }
        });
        transaction.set(planRef, { ...plan, updatedAt: FieldValue.serverTimestamp(), updatedBy: operator.uid });
      });
      return NextResponse.json({ plan });
    }

    if (action === "assign_relationship") {
      requirePlatformCapability(operator.platformRole, "relationships.assign");
      const institution = await loadInstitutionDocument(institutionId);
      const state = readPlatformState(institutionId, institution, context);
      const next = assignRelationship(state, body.relationship, operator.uid);
      await audit(actor, "relationship.assigned", institutionId, { relationship: next.relationship, previous: state.relationship }, "institution", institutionId, next, undefined, institution);
      return NextResponse.json({ view: buildInstitutionAdministrationView({ state: next, institution, usage: null, plans }) });
    }

    if (action === "assign_plan") {
      requirePlatformCapability(operator.platformRole, "plans.assign");
      const institution = await loadInstitutionDocument(institutionId);
      const state = readPlatformState(institutionId, institution, context);
      const requestedPlan = plans.find((plan) => plan.planId === body.planId);
      if (!requestedPlan || requestedPlan.status !== "active") return NextResponse.json({ error: "Only active catalog plans may be assigned." }, { status: 400 });
      const next = assignPlan(state, body.planId, operator.uid, new Date().toISOString(), context);
      await audit(actor, "plan.assigned", institutionId, {
        planId: next.planTier, previousPlanId: state.planTier, relationship: next.relationship,
        billingEnabled: next.subscription.billingEnabled, migratedFrom: next.subscription.migratedFrom ?? null,
      }, "institution", institutionId, next, async (transaction) => {
        const catalogRefs = plans.map((entry) => adminDb!.collection("platformPlanCatalog").doc(entry.planId));
        const snapshots = await transaction.getAll(...catalogRefs);
        const transactionalPlans = snapshots.map((snapshot, index) => snapshot.exists
          ? validateManagedPlan({ ...snapshot.data(), planId: snapshot.id }, plans[index].planId)
          : plans[index]);
        const currentPlan = transactionalPlans.find((plan) => plan.planId === state.planTier);
        const targetPlan = transactionalPlans.find((plan) => plan.planId === next.planTier);
        if (!currentPlan || !targetPlan) throw new Error("The managed plan catalog is incomplete.");
        const loadedCurrentPlan = plans.find((plan) => plan.planId === currentPlan.planId);
        const loadedTargetPlan = plans.find((plan) => plan.planId === targetPlan.planId);
        if (JSON.stringify(currentPlan) !== JSON.stringify(loadedCurrentPlan)
          || JSON.stringify(targetPlan) !== JSON.stringify(loadedTargetPlan)) {
          throw new Error("PLAN_CATALOG_CHANGED");
        }
        assertPlanMigrationAllowed(currentPlan, targetPlan);
        snapshots.forEach((snapshot, index) => {
          if (!snapshot.exists) {
            transaction.create(catalogRefs[index], { ...transactionalPlans[index], updatedAt: FieldValue.serverTimestamp(), updatedBy: operator.uid });
          }
        });
      });
      return NextResponse.json({ view: buildInstitutionAdministrationView({ state: next, institution, usage: null, plans }) });
    }

    if (action === "update_status") {
      requirePlatformCapability(operator.platformRole, "institutions.manage");
      const institution = await loadInstitutionDocument(institutionId);
      const state = readPlatformState(institutionId, institution, context);
      if (body.status !== "suspended" && body.status !== "active") {
        return NextResponse.json({ error: "A valid institution lifecycle status is required." }, { status: 400 });
      }
      const status = body.status;
      const next = updateInstitutionStatus(state, status, operator.uid, new Date().toISOString(), plans);
      await audit(actor, status === "suspended" ? "institution.suspended" : "institution.reactivated", institutionId, { status, planId: next.planTier }, "institution", institutionId, next, undefined, institution);
      return NextResponse.json({ view: buildInstitutionAdministrationView({ state: next, institution, usage: null, plans }) });
    }

    if (action === "update_security") {
      requirePlatformCapability(operator.platformRole, "institutions.manage");
      const institution = await loadInstitutionDocument(institutionId);
      const state = readPlatformState(institutionId, institution, context);
      const level = body.level === "restricted" ? "restricted" : body.level === "elevated" ? "elevated" : "standard";
      const next = updateSecurityState(state, level, String(body.reason ?? ""), operator.uid);
      await audit(actor, "security_state.updated", institutionId, { level, reason: next.securityState.reason, previousLevel: state.securityState.level }, "institution", institutionId, next, undefined, institution);
      return NextResponse.json({ view: buildInstitutionAdministrationView({ state: next, institution, usage: null, plans }) });
    }

    if (action === "update_policies") {
      requirePlatformCapability(operator.platformRole, "features.manage");
      const institution = await loadInstitutionDocument(institutionId);
      const state = readPlatformState(institutionId, institution, context);
      const next = updatePolicies(state, (body.policies ?? {}) as Record<string, unknown>, operator.uid);
      await audit(actor, "policies.updated", institutionId, { policies: next.policies, previous: state.policies }, "institution", institutionId, next, undefined, institution);
      return NextResponse.json({ view: buildInstitutionAdministrationView({ state: next, institution, usage: null, plans }) });
    }

    if (action === "update_billing") {
      requirePlatformCapability(operator.platformRole, "billing.manage");
      const institution = await loadInstitutionDocument(institutionId);
      const state = readPlatformState(institutionId, institution, context);
      const next = updateBillingOverride(state, {
        billingEnabled: typeof body.billingEnabled === "boolean" ? body.billingEnabled : undefined,
        invoicesEnabled: typeof body.invoicesEnabled === "boolean" ? body.invoicesEnabled : undefined,
        note: typeof body.note === "string" ? body.note : undefined,
      }, operator.uid, new Date().toISOString(), plans);
      await audit(actor, "billing.updated", institutionId, {
        billingEnabled: next.subscription.billingEnabled,
        invoicesEnabled: next.subscription.invoicesEnabled,
        previousBillingEnabled: state.subscription.billingEnabled,
      }, "institution", institutionId, next, undefined, institution);
      return NextResponse.json({ view: buildInstitutionAdministrationView({ state: next, institution, usage: null, plans }) });
    }

    if (action === "update_entitlements") {
      requirePlatformCapability(operator.platformRole, "features.manage");
      const institution = await loadInstitutionDocument(institutionId);
      const state = readPlatformState(institutionId, institution, context);
      const moduleSelection = validateModuleSelection(body.modules, tenantModules);
      const featureSelection = validateFeatureSelection(body.features);
      const limits = typeof body.limits === "object" && body.limits !== null ? body.limits as Record<string, number> : undefined;
      const next = {
        ...state,
        entitlement: updateEntitlementOverrides(
          state.entitlement,
          { modules: moduleSelection.valid, features: featureSelection.valid, ...(limits ? { limits } : {}) },
          operator.uid,
          new Date().toISOString(),
          context,
        ),
        platformUpdatedAt: new Date().toISOString(),
        platformUpdatedBy: operator.uid,
      };
      await audit(actor, "entitlements.updated", institutionId, {
        modules: moduleSelection.valid, unknownModules: moduleSelection.unknown,
        features: featureSelection.valid, unknownFeatures: featureSelection.unknown,
        limits: limits ?? null,
      }, "institution", institutionId, next, undefined, institution);
      return NextResponse.json({
        view: buildInstitutionAdministrationView({ state: next, institution, usage: null, plans }),
        rejected: { modules: moduleSelection.unknown, features: featureSelection.unknown },
      });
    }

    if (action === "update_network_trust") {
      requirePlatformCapability(operator.platformRole, "network.trust.manage");
      const trustState = body.trustState;
      if (typeof trustState !== "string" || !(networkTrustStates as readonly string[]).includes(trustState)) {
        return NextResponse.json({ error: "A valid institutional network trust state is required." }, { status: 400 });
      }
      const profileRef = adminDb!.collection("networkProfiles").doc(institutionId);
      const profileSnapshot = await profileRef.get();
      if (!profileSnapshot.exists || profileSnapshot.get("institutionId") !== institutionId) {
        return NextResponse.json({ error: "The institution has no network profile to update." }, { status: 404 });
      }
      const previousTrustState = profileSnapshot.get("platformTrustState") ?? "Registered";
      await audit(actor, "network.trust_state.updated", institutionId, {
        previousTrustState, trustState,
      }, "networkProfile", institutionId, undefined, async (transaction) => {
        const current = await transaction.get(profileRef);
        if (!current.exists || current.get("institutionId") !== institutionId) throw new Error("The network profile changed during the trust update.");
        if ((current.get("platformTrustState") ?? "Registered") !== previousTrustState) throw new Error("Network trust state changed; reload and retry.");
        transaction.set(profileRef, { trustState, platformTrustState: trustState, updatedAt: new Date().toISOString() }, { merge: true });
      });
      return NextResponse.json({ trustState });
    }

    if (action === "grant_support") {
      requirePlatformCapability(operator.platformRole, "support.grant");
      const institution = await loadInstitutionDocument(institutionId);
      const supportOperatorUid = typeof body.supportOperatorUid === "string" ? body.supportOperatorUid.trim() : "";
      const supportOperatorSnapshot = supportOperatorUid
        ? await adminDb!.collection("platformOperators").doc(supportOperatorUid).get()
        : null;
      const supportOperator = supportOperatorSnapshot?.data() as PlatformOperator | undefined;
      if (!supportOperatorSnapshot?.exists || !isActivePlatformOperator(supportOperator)
        || supportOperator.platformRole !== "Platform Support") {
        return NextResponse.json({ error: "Select an active Platform Support operator for this grant." }, { status: 400 });
      }
      const state = readPlatformState(institutionId, institution, context);
      if (!state.policies.supportAccessEnabled && body.force !== true) {
        return NextResponse.json({ error: "The institution policy has not enabled platform support access." }, { status: 403 });
      }
      const grant = createSupportGrant({
        institutionId,
        operator: { uid: supportOperator.uid, platformRole: supportOperator.platformRole },
        scopes: body.scopes,
        reason: body.reason,
        durationMinutes: typeof body.durationMinutes === "number" ? body.durationMinutes : undefined,
      });
      const grantRef = adminDb!.collection("platformSupportGrants").doc(grant.grantId);
      const securityRef = adminDb!.collection("securityEvents").doc(grant.grantId);
      await audit(actor, "support.granted", institutionId, { grantId: grant.grantId, supportOperatorUid, scopes: grant.scopes, reason: grant.reason, expiresAt: grant.expiresAt }, "supportGrant", grant.grantId, undefined, async (transaction) => {
        transaction.create(grantRef, { ...grant, createdAt: FieldValue.serverTimestamp() });
        transaction.create(securityRef, {
          eventId: grant.grantId, institutionId, uid: operator.uid, type: "sensitive_action",
          source: "platform.support-access",
          details: { grantId: grant.grantId, supportOperatorUid, scopes: grant.scopes, reason: grant.reason, expiresAt: grant.expiresAt, readOnly: true },
          createdAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ grant }, { status: 201 });
    }

    if (action === "revoke_support") {
      requirePlatformCapability(operator.platformRole, "support.grant");
      const grantId = typeof body.grantId === "string" ? body.grantId : "";
      const snapshot = await adminDb!.collection("platformSupportGrants").doc(grantId).get();
      if (!snapshot.exists) return NextResponse.json({ error: "Support grant was not found." }, { status: 404 });
      const grantRef = adminDb!.collection("platformSupportGrants").doc(grantId);
      const revokedGrant = revokeSupportGrant(snapshot.data() as SupportAccessGrant, operator.uid, String(body.reason ?? ""));
      await audit(actor, "support.revoked", revokedGrant.institutionId, { grantId, reason: revokedGrant.revokedReason }, "supportGrant", grantId, undefined, async (transaction) => {
        const current = await transaction.get(grantRef);
        if (!current.exists) throw new Error("Support grant was not found.");
        const next = revokeSupportGrant(current.data() as SupportAccessGrant, operator.uid, String(body.reason ?? ""));
        transaction.set(grantRef, { ...next, updatedAt: FieldValue.serverTimestamp() });
      });
      return NextResponse.json({ grant: revokedGrant });
    }

    if (action === "register_operator") {
      requirePlatformCapability(operator.platformRole, "operators.manage");
      const uid = typeof body.uid === "string" ? body.uid.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const platformRole = typeof body.platformRole === "string" ? body.platformRole : "";
      if (!uid || !email || !(platformRoles as readonly string[]).includes(platformRole)) {
        return NextResponse.json({ error: "uid, email and a valid platform role are required." }, { status: 400 });
      }
      if (!adminAuth) return NextResponse.json({ error: "Platform identity service is unavailable." }, { status: 503 });
      const authUser = await adminAuth.getUser(uid);
      if (authUser.email?.toLowerCase() !== email) return NextResponse.json({ error: "The email does not match the Firebase Auth user." }, { status: 400 });
      const operatorRef = adminDb!.collection("platformOperators").doc(uid);
      const newOperator = {
        uid, email, displayName: typeof body.displayName === "string" ? body.displayName : "",
        platformRole, status: "active", grantedBy: operator.uid,
        grantReason: String(body.reason ?? "Operator provisioned from the platform console."),
        grantedAt: new Date().toISOString(), updatedAt: FieldValue.serverTimestamp(),
      };
      await audit(actor, "operator.registered", null, { uid, email, platformRole }, "platformOperator", uid, undefined, async (transaction) => {
        const existing = await transaction.get(operatorRef);
        if (existing.exists) throw new Error("PLATFORM_OPERATOR_EXISTS");
        transaction.create(operatorRef, newOperator);
      });
      return NextResponse.json({ operator: { uid, email, platformRole, status: "active" } }, { status: 201 });
    }

    if (action === "set_operator_status") {
      requirePlatformCapability(operator.platformRole, "operators.manage");
      const uid = typeof body.uid === "string" ? body.uid.trim() : "";
      const status = body.status;
      if (!uid) return NextResponse.json({ error: "An operator uid is required." }, { status: 400 });
      if (status !== "active" && status !== "suspended" && status !== "revoked") return NextResponse.json({ error: "A valid operator lifecycle status is required." }, { status: 400 });
      if (uid === operator.uid && status !== "active") {
        return NextResponse.json({ error: "You cannot suspend or revoke your own platform operator record." }, { status: 400 });
      }
      const operatorRef = adminDb!.collection("platformOperators").doc(uid);
      await audit(actor, "operator.status_changed", null, { uid, status }, "platformOperator", uid, undefined, async (transaction) => {
        const existing = await transaction.get(operatorRef);
        if (!existing.exists) throw new Error("PLATFORM_OPERATOR_NOT_FOUND");
        transaction.set(operatorRef, {
          status, updatedAt: FieldValue.serverTimestamp(),
          ...(status === "revoked" ? { revokedAt: new Date().toISOString(), revokedBy: operator.uid } : {}),
        }, { merge: true });
      });
      return NextResponse.json({ uid, status });
    }

    if (action === "record_signal") {
      requirePlatformCapability(operator.platformRole, "monitoring.manage");
      const domain = typeof body.domain === "string" ? body.domain : "";
      const metric = typeof body.metric === "string" ? body.metric.trim() : "";
      const value = typeof body.value === "number" ? body.value : Number.NaN;
      const unit = typeof body.unit === "string" ? body.unit.trim() : "count";
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (!(monitoringDomains as readonly string[]).includes(domain)
        || !metric || metric.length > 100 || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000
        || !unit || unit.length > 32 || note.length > 500) {
        return NextResponse.json({ error: "A valid monitoring domain, metric, value, unit and note are required." }, { status: 400 });
      }
      await loadInstitutionDocument(institutionId);
      const signalRef = adminDb!.collection("platformMonitoringSignals").doc();
      const signalId = signalRef.id;
      const occurredAt = new Date();
      const quotaRef = adminDb!.collection("platformMonitoringSignalLimits").doc(institutionId);
      const day = occurredAt.toISOString().slice(0, 10);
      const signal: MonitoringSignal = {
        signalId, institutionId, domain: domain as MonitoringSignal["domain"], metric, value,
        unit, source: "operator-entry", note,
        capturedAt: occurredAt.toISOString(), recordedBy: operator.uid,
      };
      await audit(actor, "monitoring.signal_recorded", institutionId, { signalId, domain, metric, value }, "monitoringSignal", signalId, undefined, async (transaction) => {
        const quota = await transaction.get(quotaRef);
        const count = quota.get("day") === day ? Number(quota.get("count") ?? 0) : 0;
        if (count >= 500) throw new Error("MONITORING_SIGNAL_LIMIT");
        transaction.create(signalRef, { ...signal, createdAt: FieldValue.serverTimestamp() });
        transaction.set(quotaRef, {
          institutionId,
          day,
          count: count + 1,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ signal }, { status: 201 });
    }

    return NextResponse.json({ error: "Unsupported platform action." }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
