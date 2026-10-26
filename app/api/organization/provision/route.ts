import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { defaultMembership } from "@/lib/permissions/engine";
import { compileStaffAuthorization } from "@/lib/permissions/server";
import { createAuditEvent, deterministicId } from "@/lib/governance";
import {
  buildProvisioningRequestHash,
  computeInstitutionId,
  createInitialInstitutionRecord,
  createProvisioningRun,
  validateProvisioningRequest,
} from "@/lib/provisioning/engine";

const SYSTEM_IDENTITY = "system:provisioning";

function buildIdempotencyDocKey(uid: string, idempotencyKey: string) {
  return `provisioning:${createHash("sha256").update(`${uid}:${idempotencyKey}`).digest("hex")}`;
}

export async function POST(request: Request) {
  const token = await getSessionToken(request);
  if (!token) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const decoded = await verifyActiveSession(token);
    if (!adminDb) {
      return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    }

    const body = await request.json().catch(() => null);
    const payload = validateProvisioningRequest(body);
    const requestHash = buildProvisioningRequestHash(decoded.uid, payload);
    const institutionId = computeInstitutionId(decoded.uid, payload);
    const db = adminDb;
    const idempotencyRef = db.collection("requestIdempotency").doc(buildIdempotencyDocKey(decoded.uid, payload.idempotencyKey));
    const institutionRef = db.collection("institutions").doc(institutionId);
    const userRef = db.collection("users").doc(decoded.uid);
    const membershipRef = db.collection("memberships").doc(decoded.uid);
    const mainLocationRef = db.collection("locations").doc(`${institutionId}_main`);
    const provisioningRunRef = db.collection("institutionProvisioningRuns").doc(deterministicId("provrun", {
      uid: decoded.uid,
      institutionId,
      requestHash,
    }));

    const existingIdempotency = await idempotencyRef.get();
    if (existingIdempotency.exists) {
      const result = existingIdempotency.get("result");
      if (existingIdempotency.get("requestHash") !== requestHash) {
        return NextResponse.json({ error: "This idempotency key was already used for a different provisioning request." }, { status: 409 });
      }
      return NextResponse.json(result, { status: 200 });
    }

    const now = new Date().toISOString();
    const run = createProvisioningRun({
      uid: decoded.uid,
      institutionId,
      institutionName: payload.institutionName,
      country: payload.country,
      email: payload.email,
      institutionType: payload.institutionType,
      idempotencyKey: payload.idempotencyKey,
      now,
    });

    const result = await db.runTransaction(async (transaction) => {
      const [userSnapshot, institutionSnapshot, membershipSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(institutionRef),
        transaction.get(membershipRef),
      ]);

      if (institutionSnapshot.exists && institutionSnapshot.get("createdBy") === decoded.uid) {
        throw new Error("INSTITUTION_ALREADY_EXISTS");
      }
      if (userSnapshot.exists && typeof userSnapshot.get("institutionId") === "string" && userSnapshot.get("institutionId") !== institutionId) {
        throw new Error("USER_ALREADY_HAS_INSTITUTION");
      }
      if (membershipSnapshot.exists && typeof membershipSnapshot.get("institutionId") === "string" && membershipSnapshot.get("institutionId") !== institutionId) {
        throw new Error("MEMBERSHIP_CONFLICT");
      }

      const institutionRecord = createInitialInstitutionRecord({
        institutionId,
        createdBy: decoded.uid,
        institutionName: payload.institutionName,
        country: payload.country,
        institutionType: payload.institutionType,
        now,
      });

      const userRecord = {
        uid: decoded.uid,
        institutionId,
        fullName: payload.fullName,
        email: payload.email,
        role: "Owner",
        departmentId: userSnapshot.get("departmentId") ?? null,
        status: "active",
        securityStatus: "standard",
        sessionPolicy: "7_days",
        preferences: {
          theme: "dark",
          language: "en",
          timezone: "UTC",
          dateFormat: "MM/DD/YYYY",
          timeFormat: "24h",
          density: "comfortable",
        },
        createdAt: userSnapshot.exists ? (userSnapshot.get("createdAt") ?? FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      const membership = {
        ...defaultMembership({ institutionId, tier: "Owner" }),
        uid: decoded.uid,
        roleIds: [],
        createdBy: decoded.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: decoded.uid,
        schemaVersion: 1,
      };

      const auditEvent = createAuditEvent({
        eventId: `institution_provisioning_${institutionId}`,
        institutionId,
        actorUid: decoded.uid,
        action: "institution.provisioning.created",
        resourceType: "institution",
        resourceId: institutionId,
        payload: {
          institutionType: payload.institutionType,
          country: payload.country,
          idempotencyKey: payload.idempotencyKey,
        },
        occurredAt: now,
        previousHash: null,
        sequence: 0,
      });

      const nextRun = {
        ...run,
        status: "completed",
        progress: 100,
        steps: [
          { name: "identity_validated", status: "completed", message: "Authenticated user and request details were validated." },
          { name: "institution_record_created", status: "completed", message: "Institution document was created." },
          { name: "owner_membership_created", status: "completed", message: "Owner membership was created." },
          { name: "subscription_entitlement_applied", status: "completed", message: "Default plan and entitlement were applied." },
          { name: "initial_location_created", status: "completed", message: "The main site location was created." },
          { name: "audit_logged", status: "completed", message: "Provisioning audit record was written." },
        ],
        updatedAt: FieldValue.serverTimestamp(),
      };

      transaction.set(institutionRef, institutionRecord, { merge: false });
      transaction.set(userRef, userRecord, { merge: true });
      transaction.set(membershipRef, membership, { merge: true });
      transaction.set(mainLocationRef, {
        locationId: `${institutionId}_main`,
        institutionId,
        name: `${payload.institutionName} Main Site`,
        country: payload.country,
        status: "active",
        createdBy: decoded.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(provisioningRunRef, nextRun, { merge: true });
      transaction.set(db.collection("securityEvents").doc(auditEvent.eventId), {
        ...auditEvent,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(idempotencyRef, {
        uid: decoded.uid,
        institutionId,
        requestHash,
        result: {
          ok: true,
          institutionId,
          institutionName: payload.institutionName,
          country: payload.country,
          institutionType: payload.institutionType,
          status: "completed",
        },
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return {
        ok: true,
        institutionId,
        institutionName: payload.institutionName,
        country: payload.country,
        institutionType: payload.institutionType,
        status: "completed",
      };
    });

    await compileStaffAuthorization(decoded.uid);
    return NextResponse.json(result, { status: 201 });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Institution provisioning failed.";
    if (message.includes("already used")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message.includes("INSTITUTION_ALREADY_EXISTS") || message.includes("USER_ALREADY_HAS_INSTITUTION") || message.includes("MEMBERSHIP_CONFLICT")) {
      return NextResponse.json({ error: "This user cannot create a second institution while an active institution exists." }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
