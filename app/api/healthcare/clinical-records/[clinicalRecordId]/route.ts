import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import {
  assertClinicalRecordScope,
  clinicalIdempotencyDocumentId,
  clinicalRequestHash,
  createClinicalAuditFields,
  ClinicalRecordRequestError,
  parseClinicalRecordPatch,
  readClinicalAuthorizationState,
} from "@/lib/healthcare/clinical-records-server";
import { PermissionAuthorizationError, requirePermission } from "@/lib/permissions/server";

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 16_384) {
    throw new ClinicalRecordRequestError(400, "The clinical record request is too large.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ClinicalRecordRequestError(400, "The request body must be valid JSON.");
  }
}

function authorizationError(reason: unknown) {
  if (reason instanceof ClinicalRecordRequestError) {
    const status = reason.status === 409 && reason.message === "The clinical record is invalid or unavailable."
      ? 404 : reason.status;
    return NextResponse.json({ error: status === 404 ? "Clinical record not found." : reason.message }, { status });
  }
  if (reason instanceof PermissionAuthorizationError) {
    const message = reason.status === 401 ? "Authentication is required."
      : reason.status === 409 ? "Authorization must be refreshed."
        : reason.message.includes("Recent reauthentication is required")
          ? "Please reauthenticate before changing clinical records."
        : "Clinical record access is not authorized.";
    return NextResponse.json({ error: message }, { status: reason.status });
  }
  if (reason instanceof Error
    && ((("code" in reason) && typeof reason.code === "string" && reason.code.startsWith("auth/"))
      || reason.message.includes("Session is not registered")
      || reason.message.includes("Session has been revoked")
      || reason.message.includes("Session has expired")
      || reason.message.includes("User account is not active")
      || reason.message.startsWith("Firebase ID token"))) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }
  console.error("Unable to update clinical record.", reason instanceof Error ? reason.name : "UnknownError");
  return NextResponse.json({ error: "Unable to process the clinical record request." }, { status: 500 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ clinicalRecordId: string }> },
) {
  try {
    if (!adminDb) throw new ClinicalRecordRequestError(503, "Clinical record service is unavailable.");
    const token = await getSessionToken(request);
    if (!token) throw new ClinicalRecordRequestError(401, "Authentication is required.");
    const decoded = await verifyActiveSession(token);
    const context = await requirePermission(
      request, "health.record.write", { recordOwnerUid: decoded.uid },
    );
    const { clinicalRecordId } = await params;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(clinicalRecordId)) {
      throw new ClinicalRecordRequestError(404, "Clinical record not found.");
    }
    const patch = parseClinicalRecordPatch(await readJson(request));
    const requestHash = clinicalRequestHash(patch);
    const idempotencyId = clinicalIdempotencyDocumentId(context.uid, context.institutionId, "update", patch.idempotencyKey);
    const idempotencyRef = adminDb.collection("requestIdempotency").doc(idempotencyId);
    const recordRef = adminDb.collection("clinicalRecords").doc(clinicalRecordId);
    const auditRef = adminDb.collection("clinicalAuditEvents").doc();

    const result = await adminDb.runTransaction(async (transaction) => {
      const state = await readClinicalAuthorizationState(transaction, context, token, "health.record.write");
      const [idempotency, existingSnapshot] = await transaction.getAll(idempotencyRef, recordRef);
      if (!existingSnapshot.exists) throw new ClinicalRecordRequestError(404, "Clinical record not found.");
      const existing = await assertClinicalRecordScope(
        transaction, state, context, existingSnapshot.data(), clinicalRecordId,
      );
      const resulting: typeof existing = {
        ...existing,
        ...(patch.recordType === undefined ? {} : { recordType: patch.recordType }),
        ...(patch.summary === undefined ? {} : { summary: patch.summary }),
        ...(patch.sensitivity === undefined ? {} : { sensitivity: patch.sensitivity }),
        ...(patch.specialtyId === undefined ? {} : { specialtyId: patch.specialtyId }),
        updatedAt: Timestamp.now(),
      };
      await assertClinicalRecordScope(transaction, state, context, resulting, clinicalRecordId);

      if (idempotency.exists) {
        if (idempotency.get("uid") !== context.uid
          || idempotency.get("institutionId") !== context.institutionId
          || idempotency.get("operation") !== "update"
          || idempotency.get("requestHash") !== requestHash
          || idempotency.get("clinicalRecordId") !== clinicalRecordId) {
          throw new ClinicalRecordRequestError(409, "The idempotency key conflicts with another request.");
        }
        return { clinicalRecordId, replay: true };
      }

      transaction.update(recordRef, {
        ...(patch.recordType === undefined ? {} : { recordType: patch.recordType }),
        ...(patch.summary === undefined ? {} : { summary: patch.summary }),
        ...(patch.sensitivity === undefined ? {} : { sensitivity: patch.sensitivity }),
        ...(patch.specialtyId === undefined ? {} : { specialtyId: patch.specialtyId }),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(auditRef, createClinicalAuditFields(
        context, "update", clinicalRecordId,
      ));
      transaction.create(idempotencyRef, {
        uid: context.uid,
        institutionId: context.institutionId,
        operation: "update",
        requestHash,
        clinicalRecordId,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { clinicalRecordId, replay: false };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (reason) {
    return authorizationError(reason);
  }
}
