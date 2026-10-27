import { randomUUID } from "node:crypto";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import {
  assertClinicalRecordScope,
  clinicalWriteCapabilities,
  clinicalIdempotencyDocumentId,
  clinicalRequestHash,
  createClinicalAuditFields,
  createClinicalReadAuditFields,
  ClinicalRecordRequestError,
  parseClinicalRecordCreate,
  readClinicalAuthorizationState,
} from "@/lib/healthcare/clinical-records-server";
import {
  PermissionAuthorizationError,
  requirePermission,
  type PermissionContext,
} from "@/lib/permissions/server";

const clinicalRecordIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const cursorIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pageSize = 25;
const scanLimit = 100;

type ClinicalReadCursor = {
  uid: string;
  institutionId: string;
  permissionVersion: number;
  lastScannedId: string | null;
  pendingRecordId: string | null;
  expiresAt: Timestamp;
};

function parseClinicalReadCursor(value: unknown): ClinicalReadCursor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.uid !== "string" || typeof data.institutionId !== "string"
    || !Number.isSafeInteger(data.permissionVersion)
    || !(data.lastScannedId === null || (typeof data.lastScannedId === "string"
      && clinicalRecordIdPattern.test(data.lastScannedId)))
    || !(data.pendingRecordId === null || (typeof data.pendingRecordId === "string"
      && clinicalRecordIdPattern.test(data.pendingRecordId)))
    || !(data.expiresAt instanceof Timestamp)) return null;
  return {
    uid: data.uid,
    institutionId: data.institutionId,
    permissionVersion: data.permissionVersion as number,
    lastScannedId: data.lastScannedId as string | null,
    pendingRecordId: data.pendingRecordId as string | null,
    expiresAt: data.expiresAt,
  };
}

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

function authorizationError(reason: unknown, action: string) {
  if (reason instanceof ClinicalRecordRequestError) {
    return NextResponse.json({ error: reason.message }, { status: reason.status });
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
  console.error(`Unable to ${action} clinical records.`, reason instanceof Error ? reason.name : "UnknownError");
  return NextResponse.json({ error: "Unable to process the clinical record request." }, { status: 500 });
}

function clinicalRecordResponse(
  record: Awaited<ReturnType<typeof assertClinicalRecordScope>>,
  canUpdate: boolean,
) {
  return {
    clinicalRecordId: record.clinicalRecordId,
    institutionId: record.institutionId,
    patientId: record.patientId,
    encounterId: record.encounterId,
    recordType: record.recordType,
    summary: record.summary,
    sensitivity: record.sensitivity,
    authoredBy: record.authoredBy,
    createdAt: record.createdAt.toDate().toISOString(),
    ...(record.updatedAt ? { updatedAt: record.updatedAt.toDate().toISOString() } : {}),
    ...(record.specialtyId === undefined ? {} : { specialtyId: record.specialtyId }),
    ...(record.locationId === undefined ? {} : { locationId: record.locationId }),
    ...(record.unitId === undefined ? {} : { unitId: record.unitId }),
    ...(record.departmentId === undefined ? {} : { departmentId: record.departmentId }),
    canUpdate,
  };
}

export async function GET(request: Request) {
  try {
    if (!adminDb) throw new ClinicalRecordRequestError(503, "Clinical record service is unavailable.");
    const token = await getSessionToken(request);
    if (!token) throw new ClinicalRecordRequestError(401, "Authentication is required.");
    const decoded = await verifyActiveSession(token);
    const scope = { recordOwnerUid: decoded.uid };
    let context: PermissionContext;
    let permissionKey: "health.record.read" | "health.record.write";
    let canRead = true;
    try {
      context = await requirePermission(request, "health.record.read", scope);
      permissionKey = "health.record.read";
    } catch (reason) {
      if (!(reason instanceof PermissionAuthorizationError) || reason.status !== 403) throw reason;
      context = await requirePermission(request, "health.record.write", scope, { stepUp: false });
      permissionKey = "health.record.write";
      canRead = false;
    }

    const cursorValue = new URL(request.url).searchParams.get("cursor");
    const cursor = cursorValue === null ? null : cursorValue;
    if (cursor !== null && !cursorIdPattern.test(cursor)) {
      throw new ClinicalRecordRequestError(400, "The clinical record cursor is invalid.");
    }
    let records: Array<ReturnType<typeof clinicalRecordResponse>> = [];
    let nextCursor: string | null = null;
    let state: Awaited<ReturnType<typeof readClinicalAuthorizationState>>;

    if (canRead) {
      const newCursorId = randomUUID();
      const cursorRef = adminDb.collection("clinicalRecordReadCursors").doc(cursor ?? newCursorId);
      const result = await adminDb.runTransaction(async (transaction) => {
        let storedCursor: ClinicalReadCursor | null = null;
        if (cursor) {
          const cursorSnapshot = await transaction.get(cursorRef);
          const cursorData = parseClinicalReadCursor(cursorSnapshot.data());
          if (!cursorSnapshot.exists || !cursorData
            || cursorData.uid !== context.uid
            || cursorData.institutionId !== context.institutionId
            || cursorData.permissionVersion !== context.permissionVersion
            || cursorSnapshot.get("permissionKey") !== "health.record.read"
            || cursorData.expiresAt.toMillis() <= Date.now()) {
            throw new ClinicalRecordRequestError(409, "The clinical record cursor is invalid or expired.");
          }
          storedCursor = cursorData;
        }
        const pendingSnapshot = storedCursor?.pendingRecordId
          ? await transaction.get(adminDb!.collection("clinicalRecords").doc(storedCursor.pendingRecordId))
          : null;
        let query = adminDb!.collection("clinicalRecords")
          .where("institutionId", "==", context.institutionId)
          .orderBy(FieldPath.documentId())
          .limit(scanLimit);
        if (storedCursor?.lastScannedId) query = query.startAfter(storedCursor.lastScannedId);
        const snapshot = await transaction.get(query);
        const authorization = await readClinicalAuthorizationState(
          transaction, context, token, permissionKey,
        );
        const authorizationState = authorization;
        const pageRecords: Array<ReturnType<typeof clinicalRecordResponse>> = [];
        let lastScannedId = storedCursor?.lastScannedId ?? null;
        let pendingRecordId: string | null = null;
        const addIfAuthorized = async (documentId: string, value: unknown) => {
          try {
            const authorized = await assertClinicalRecordScope(
              null,
              authorizationState,
              context,
              value,
              documentId,
              { validateReferences: false, allowAdditionalFields: true, requireSpecialty: false },
            );
            if (pageRecords.length >= pageSize) return false;
            let canUpdate = false;
            if (authorizationState.writeGrant) {
              try {
                await assertClinicalRecordScope(
                  null,
                  { ...authorizationState, grant: authorizationState.writeGrant },
                  context,
                  value,
                  documentId,
                  { validateReferences: false, allowAdditionalFields: true },
                );
                canUpdate = true;
              } catch (reason) {
                if (!(reason instanceof ClinicalRecordRequestError) || reason.status !== 403) throw reason;
              }
            }
            pageRecords.push(clinicalRecordResponse(authorized, canUpdate));
            return true;
          } catch (reason) {
            if (!(reason instanceof ClinicalRecordRequestError) || reason.status !== 403) throw reason;
            return true;
          }
        };
        if (storedCursor?.pendingRecordId && pendingSnapshot?.exists) {
          await addIfAuthorized(pendingSnapshot.id, pendingSnapshot.data());
        }
        for (const document of snapshot.docs) {
          lastScannedId = document.id;
          const added = await addIfAuthorized(document.id, document.data());
          if (!added) {
            pendingRecordId = document.id;
            break;
          }
        }
        const hasMore = Boolean(pendingRecordId) || snapshot.docs.length === scanLimit;
        let cursorId: string | null = null;
        if (pageRecords.length) {
          transaction.create(
            adminDb!.collection("clinicalAuditEvents").doc(),
            createClinicalReadAuditFields(
              context,
              pageRecords.map((record) => record.clinicalRecordId),
            ),
          );
        }
        if (hasMore) {
          cursorId = cursor ?? newCursorId;
          const cursorData = {
            uid: context.uid,
            institutionId: context.institutionId,
            permissionVersion: context.permissionVersion,
            permissionKey: "health.record.read",
            lastScannedId,
            pendingRecordId,
            expiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
          };
          if (cursor) transaction.set(cursorRef, cursorData);
          else transaction.create(cursorRef, cursorData);
        } else if (cursor) {
          transaction.delete(cursorRef);
        }
        return { authorization, records: pageRecords, nextCursor: cursorId };
      });
      state = result.authorization;
      records = result.records;
      nextCursor = result.nextCursor;
    } else {
      state = await adminDb.runTransaction((transaction) =>
        readClinicalAuthorizationState(transaction, context, token, permissionKey));
    }

    const writeCapabilities = clinicalWriteCapabilities(state, context);
    return NextResponse.json({
      records,
      nextCursor,
      canRead,
      canWrite: Boolean(writeCapabilities),
      writeCapabilities,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    return authorizationError(reason, "read");
  }
}

export async function POST(request: Request) {
  try {
    if (!adminDb) throw new ClinicalRecordRequestError(503, "Clinical record service is unavailable.");
    const token = await getSessionToken(request);
    if (!token) throw new ClinicalRecordRequestError(401, "Authentication is required.");
    const decoded = await verifyActiveSession(token);
    const context = await requirePermission(
      request, "health.record.write", { recordOwnerUid: decoded.uid },
    );
    const input = parseClinicalRecordCreate(await readJson(request));
    const requestHash = clinicalRequestHash(input);
    const idempotencyId = clinicalIdempotencyDocumentId(context.uid, context.institutionId, "create", input.idempotencyKey);
    const idempotencyRef = adminDb.collection("requestIdempotency").doc(idempotencyId);
    const recordRef = adminDb.collection("clinicalRecords").doc();
    const auditRef = adminDb.collection("clinicalAuditEvents").doc();

    const result = await adminDb.runTransaction(async (transaction) => {
      const state = await readClinicalAuthorizationState(transaction, context, token, "health.record.write");
      const idempotency = await transaction.get(idempotencyRef);
      if (idempotency.exists) {
        if (idempotency.get("uid") !== context.uid
          || idempotency.get("institutionId") !== context.institutionId
          || idempotency.get("operation") !== "create"
          || idempotency.get("requestHash") !== requestHash
          || typeof idempotency.get("clinicalRecordId") !== "string") {
          throw new ClinicalRecordRequestError(409, "The idempotency key conflicts with another request.");
        }
        const replayId = idempotency.get("clinicalRecordId") as string;
        const replayRef = adminDb!.collection("clinicalRecords").doc(replayId);
        const replay = await transaction.get(replayRef);
        if (!replay.exists) throw new ClinicalRecordRequestError(409, "The prior request result is unavailable.");
        await assertClinicalRecordScope(transaction, state, context, replay.data(), replayId);
        return { clinicalRecordId: replayId, replay: true };
      }

      const candidate = {
        clinicalRecordId: recordRef.id,
        institutionId: context.institutionId,
        patientId: input.patientId,
        encounterId: input.encounterId,
        recordType: input.recordType,
        summary: input.summary,
        sensitivity: input.sensitivity,
        authoredBy: context.uid,
        createdAt: Timestamp.now(),
        ...(input.specialtyId === undefined ? {} : { specialtyId: input.specialtyId }),
        ...(input.locationId === undefined ? {} : { locationId: input.locationId }),
        ...(input.unitId === undefined ? {} : { unitId: input.unitId }),
        ...(input.departmentId === undefined ? {} : { departmentId: input.departmentId }),
      };
      const authorizedRecord = await assertClinicalRecordScope(
        transaction, state, context, candidate, recordRef.id,
      );
      transaction.create(recordRef, authorizedRecord);
      transaction.create(auditRef, createClinicalAuditFields(
        context, "create", recordRef.id,
      ));
      transaction.create(idempotencyRef, {
        uid: context.uid,
        institutionId: context.institutionId,
        operation: "create",
        requestHash,
        clinicalRecordId: recordRef.id,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { clinicalRecordId: recordRef.id, replay: false };
    });

    return NextResponse.json(result, { status: result.replay ? 200 : 201 });
  } catch (reason) {
    return authorizationError(reason, "create");
  }
}
