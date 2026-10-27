import { createHash, randomUUID } from "node:crypto";
import { FieldPath, FieldValue, Timestamp, type DocumentData, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { PermissionAuthorizationError, requirePermission } from "@/lib/permissions/server";
import { PERMISSION_REGISTRY } from "@/lib/permissions/registry";
import {
  buildSecurityPostureChecks,
  SECURITY_INCIDENT_STATUSES,
  transitionSecurityIncident,
  type SecurityIncidentSeverity,
  type SecurityIncidentStatus,
} from "@/lib/security-center/engine";

const SAMPLE_LIMIT = 25;
const INCIDENT_PAGE_SIZE = 20;
const validSeverities = new Set<SecurityIncidentSeverity>(["low", "moderate", "high", "critical"]);

type CursorData = {
  uid: string;
  institutionId: string;
  permissionVersion: number;
  updatedAtMillis: number;
  documentId: string;
};

function decodeCursor(value: string, context: { uid: string; institutionId: string; permissionVersion: number }): CursorData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("INVALID_CURSOR");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("INVALID_CURSOR");
  const cursor = parsed as Partial<CursorData>;
  if (cursor.uid !== context.uid || cursor.institutionId !== context.institutionId
    || cursor.permissionVersion !== context.permissionVersion
    || !Number.isSafeInteger(cursor.updatedAtMillis) || typeof cursor.documentId !== "string"
    || !cursor.documentId) {
    throw new Error("INVALID_CURSOR");
  }
  return cursor as CursorData;
}

function encodeCursor(cursor: CursorData) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function asMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isoDate(value: unknown) {
  const millis = asMillis(value);
  return millis === null ? null : new Date(millis).toISOString();
}

async function loadSample(collection: string, institutionId: string): Promise<QueryDocumentSnapshot<DocumentData>[] | null> {
  if (!adminDb) return null;
  try {
    const result = await adminDb.collection(collection)
      .where("institutionId", "==", institutionId)
      .limit(SAMPLE_LIMIT)
      .get();
    return result.docs;
  } catch (error) {
    console.error(`Unable to load Security Center source: ${collection}.`, error);
    return null;
  }
}

function sampleCount<T>(records: T[] | null, predicate: (record: T) => boolean): number | null {
  return records === null ? null : records.filter(predicate).length;
}

function canonicalIncidentStatus(value: unknown): SecurityIncidentStatus {
  if (typeof value !== "string") throw new Error("CONFLICT");
  const legacy: Record<string, SecurityIncidentStatus> = {
    open: "OPEN",
    investigating: "TRIAGED",
    contained: "CONTAINING",
    resolved: "RESOLVED",
    closed: "CLOSED",
  };
  if (value === "draft" || (SECURITY_INCIDENT_STATUSES as readonly string[]).includes(value)) {
    return value as SecurityIncidentStatus;
  }
  const normalized = legacy[value.toLowerCase()];
  if (!normalized) throw new Error("CONFLICT");
  return normalized;
}

function incidentResponseForAccess(
  snapshot: QueryDocumentSnapshot<DocumentData>,
  mayReadDetails: boolean,
) {
  const data = snapshot.data();
  return {
    incidentId: snapshot.id,
    title: mayReadDetails ? data.title : "Restricted incident",
    summary: mayReadDetails ? data.summary : "Incident details require incident-management access.",
    severity: mayReadDetails ? data.severity : "restricted",
    status: canonicalIncidentStatus(data.status),
    version: data.version,
    createdAt: isoDate(data.createdAt),
    updatedAt: isoDate(data.updatedAt),
  };
}

function failure(error: unknown) {
  if (error instanceof PermissionAuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const code = error instanceof Error ? error.message : "";
  const status = code === "SERVICE_UNAVAILABLE" ? 503
    : code === "UNAUTHENTICATED" ? 401
      : code === "FORBIDDEN" ? 403
        : code === "INVALID_CURSOR" ? 400
          : code === "CONFLICT" ? 409 : 400;
  if (status >= 500) console.error("Security Center request failed.", error);
  return NextResponse.json({
    error: status === 401 ? "Authentication required."
      : status === 403 ? "Security Center access is not authorized."
        : status === 409 ? "The incident changed; refresh and try again."
          : status === 503 ? "Security Center is temporarily unavailable."
            : "Unable to process the Security Center request.",
  }, { status });
}

async function containUserSessions(input: {
  institutionId: string;
  actorUid: string;
  uid: string;
  incidentId: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
}) {
  if (!adminDb || !adminAuth) throw new Error("SERVICE_UNAVAILABLE");
  const { institutionId, actorUid, uid, incidentId, expectedVersion, reason, idempotencyKey } = input;
  const targetRefs = [
    adminDb.collection("users").doc(uid),
    adminDb.collection("memberships").doc(uid),
  ];
  const [profile, membership] = await adminDb.getAll(...targetRefs);
  if (!profile.exists || profile.get("institutionId") !== institutionId || profile.get("status") !== "active"
    || !membership.exists || membership.get("institutionId") !== institutionId || membership.get("status") !== "active") {
    throw new Error("FORBIDDEN");
  }

  const sessionSnapshot = await adminDb.collection("securitySessions")
    .where("uid", "==", uid)
    .limit(501)
    .get();
  if (sessionSnapshot.size > 500 || sessionSnapshot.docs.some((session) => session.get("institutionId") !== institutionId)) {
    throw new Error("CONFLICT");
  }
  const activeSessions = sessionSnapshot.docs.filter((session) => session.get("status") === "active");
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ action: "contain_sessions", institutionId, actorUid, uid, incidentId, expectedVersion, reason }))
    .digest("hex");
  const keyHash = createHash("sha256").update(`${actorUid}:${idempotencyKey}`).digest("hex");
  const idempotencyRef = adminDb.collection("securityIdempotency").doc(keyHash);
  const incidentRef = adminDb.collection("securityIncidents").doc(incidentId);
  const requestedEventRef = incidentRef.collection("timeline").doc();
  const requestedAuditRef = adminDb.collection("securityAuditEvents").doc();
  const reservation = await adminDb.runTransaction(async (transaction) => {
    const [existing, incident] = await transaction.getAll(idempotencyRef, incidentRef);
    if (existing.exists) {
      if (existing.get("requestHash") !== requestHash || existing.get("institutionId") !== institutionId) {
        throw new Error("CONFLICT");
      }
      if (existing.get("status") === "failed") throw new Error("CONFLICT");
      if (existing.get("status") === "completed") {
        return { proceed: false as const, result: existing.get("result") as { incidentId: string; status: SecurityIncidentStatus; duplicate: boolean } };
      }
      return { proceed: true as const, version: Number(existing.get("expectedVersion")) };
    }
    if (!incident.exists || incident.get("institutionId") !== institutionId) throw new Error("FORBIDDEN");
    if (incident.get("version") !== expectedVersion || canonicalIncidentStatus(incident.get("status")) !== "TRIAGED") {
      throw new Error("CONFLICT");
    }
    transaction.create(idempotencyRef, {
      institutionId,
      actorUid,
      action: "contain_sessions",
      incidentId,
      requestHash,
      expectedVersion,
      targetUid: uid,
      result: null,
      status: "pending",
      module: "security-center",
      sourceType: "securityIncident",
      sourceId: incidentId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
      schemaVersion: 1,
    });
    transaction.create(requestedEventRef, {
      eventId: requestedEventRef.id,
      institutionId,
      incidentId,
      action: "containment_requested",
      reason,
      actorUid,
      targetUid: uid,
      previousState: "TRIAGED",
      newState: "TRIAGED",
      status: "recorded",
      module: "security-center",
      sourceType: "securityIncident",
      sourceId: incidentId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
      schemaVersion: 1,
    });
    transaction.create(requestedAuditRef, {
      eventId: requestedAuditRef.id,
      institutionId,
      actorUid,
      action: "security.incident.containment_requested",
      where: "security-center",
      reference: incidentId,
      result: "pending",
      previousState: "TRIAGED",
      newState: "TRIAGED",
      reason,
      targetUid: uid,
      status: "recorded",
      module: "security-center",
      sourceType: "securityIncident",
      sourceId: incidentId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
      schemaVersion: 1,
    });
    return { proceed: true as const, version: expectedVersion };
  });
  if (!reservation.proceed) return { ...reservation.result, duplicate: true };

  try {
    await adminAuth.revokeRefreshTokens(uid);
    const batch = adminDb.batch();
    activeSessions.forEach((session) => batch.update(session.ref, {
      status: "revoked",
      revokedBy: actorUid,
      revokedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }));
    if (activeSessions.length) await batch.commit();
  } catch (error) {
    console.error("Security incident session containment failed.", error);
    const failedAuditRef = adminDb.collection("securityAuditEvents").doc();
    await adminDb.runTransaction(async (transaction) => {
      const current = await transaction.get(idempotencyRef);
      if (current.exists && current.get("status") === "pending") {
        transaction.update(idempotencyRef, {
          status: "failed",
          result: { incidentId, status: "TRIAGED", duplicate: false },
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorUid,
        });
        transaction.create(failedAuditRef, {
          eventId: failedAuditRef.id,
          institutionId,
          actorUid,
          action: "security.incident.containment_failed",
          where: "security-center",
          reference: incidentId,
          result: "failed",
          previousState: "TRIAGED",
          newState: "TRIAGED",
          reason,
          targetUid: uid,
          status: "recorded",
          module: "security-center",
          sourceType: "securityIncident",
          sourceId: incidentId,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actorUid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorUid,
          schemaVersion: 1,
        });
      }
    });
    throw new Error("SERVICE_UNAVAILABLE");
  }

  const completedAuditRef = adminDb.collection("securityAuditEvents").doc();
  const eventRef = incidentRef.collection("timeline").doc();
  return adminDb.runTransaction(async (transaction) => {
    const [currentIdempotency, incident] = await transaction.getAll(idempotencyRef, incidentRef);
    if (!currentIdempotency.exists || currentIdempotency.get("requestHash") !== requestHash) throw new Error("CONFLICT");
    if (currentIdempotency.get("status") === "completed") {
      return { ...(currentIdempotency.get("result") as { incidentId: string; status: SecurityIncidentStatus }), duplicate: true };
    }
    const status = incident.exists && incident.get("institutionId") === institutionId
      && incident.get("version") === reservation.version
      && canonicalIncidentStatus(incident.get("status")) === "TRIAGED"
      ? "CONTAINING"
      : canonicalIncidentStatus(incident.get("status"));
    const version = status === "CONTAINING" ? reservation.version + 1 : Number(incident.get("version"));
    if (status === "CONTAINING") {
      transaction.update(incidentRef, {
        status,
        version,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      });
    }
    transaction.create(eventRef, {
      eventId: eventRef.id,
      institutionId,
      incidentId,
      action: "sessions_revoked",
      reason,
      actorUid,
      targetUid: uid,
      previousState: "TRIAGED",
      newState: status,
      status: "recorded",
      module: "security-center",
      sourceType: "securityIncident",
      sourceId: incidentId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
      schemaVersion: 1,
    });
    transaction.create(completedAuditRef, {
      eventId: completedAuditRef.id,
      institutionId,
      actorUid,
      action: "security.incident.sessions_revoked",
      where: "security-center",
      reference: incidentId,
      result: "success",
      previousState: "TRIAGED",
      newState: status,
      reason,
      targetUid: uid,
      sessionCount: activeSessions.length,
      status: "recorded",
      module: "security-center",
      sourceType: "securityIncident",
      sourceId: incidentId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
      schemaVersion: 1,
    });
    const result = { incidentId, status, version, duplicate: false };
    transaction.update(idempotencyRef, {
      status: "completed",
      result,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid,
    });
    return result;
  });
}

export async function GET(request: Request) {
  try {
    const context = await requirePermission(request, "security.center.read");
    if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
    const params = new URL(request.url).searchParams;
    const cursorValue = params.get("cursor");
    const cursor = cursorValue ? decodeCursor(cursorValue, context) : null;
    let incidentsQuery = adminDb.collection("securityIncidents")
      .where("institutionId", "==", context.institutionId)
      .orderBy("updatedAt", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .limit(INCIDENT_PAGE_SIZE + 1);
    if (cursor) {
      incidentsQuery = incidentsQuery.startAfter(Timestamp.fromMillis(cursor.updatedAtMillis), cursor.documentId);
    }

    const [
      incidentsSnapshot,
      users,
      effectivePermissions,
      sessions,
      terminalSessions,
      supportGrants,
      exports,
      breakGlass,
      documents,
      integrationCredentials,
      roles,
    ] = await Promise.all([
      incidentsQuery.get(),
      loadSample("users", context.institutionId),
      loadSample("effectivePermissions", context.institutionId),
      loadSample("securitySessions", context.institutionId),
      loadSample("terminalSessions", context.institutionId),
      loadSample("platformSupportGrants", context.institutionId),
      loadSample("analyticsExportAudit", context.institutionId),
      loadSample("breakGlassAccess", context.institutionId),
      loadSample("documents", context.institutionId),
      loadSample("integrationCredentials", context.institutionId),
      loadSample("roles", context.institutionId),
    ]);

    const pageDocs = incidentsSnapshot.docs.slice(0, INCIDENT_PAGE_SIZE);
    const last = pageDocs.at(-1);
    const nextCursor = incidentsSnapshot.docs.length > INCIDENT_PAGE_SIZE && last
      ? encodeCursor({
        uid: context.uid,
        institutionId: context.institutionId,
        permissionVersion: context.permissionVersion,
        updatedAtMillis: asMillis(last.get("updatedAt")) ?? 0,
        documentId: last.id,
      })
      : null;

    let mfaUnenrolled: number | null = null;
    if (users !== null && adminAuth) {
      try {
        const privilegedUsers = users.filter((user) => ["Owner", "Admin"].includes(String(user.get("role"))));
        const authUsers = await adminAuth.getUsers(privilegedUsers.map((user) => ({ uid: user.id })));
        const enrolled = new Set(authUsers.users
          .filter((user) => (user.multiFactor?.enrolledFactors.length ?? 0) > 0)
          .map((user) => user.uid));
        mfaUnenrolled = privilegedUsers.filter((user) => !enrolled.has(user.id)).length;
      } catch (error) {
        console.error("Unable to load privileged-user MFA posture.", error);
      }
    }

    const dangerousKeys = new Set(Object.entries(PERMISSION_REGISTRY)
      .filter(([, definition]) => definition.dangerous)
      .map(([key]) => key));
    const activeEffectiveGrants = effectivePermissions?.flatMap((record) => {
      const grants = record.get("grants");
      return Array.isArray(grants) ? grants.filter((grant) => grant && dangerousKeys.has(grant.key)) : [];
    }) ?? null;
    const now = Date.now();
    const checks = buildSecurityPostureChecks({
      sampleSize: SAMPLE_LIMIT,
      mfaUnenrolled,
      elevatedGrantCount: activeEffectiveGrants === null ? null : activeEffectiveGrants.length,
      inactiveAccountCount: sampleCount(users, (record) => record.get("status") === "inactive"),
      activeSessionCount: sampleCount(sessions, (record) =>
        record.get("status") === "active" && (asMillis(record.get("expiresAt")) ?? 0) > now),
      activeTerminalCount: sampleCount(terminalSessions, (record) =>
        record.get("status") === "active" && (asMillis(record.get("expiresAt")) ?? 0) > now),
      activeSupportGrantCount: sampleCount(supportGrants, (record) =>
        record.get("status") === "active" && (asMillis(record.get("expiresAt")) ?? 0) > now),
      exportCount: exports === null ? null : exports.length,
      activeBreakGlassCount: sampleCount(breakGlass, (record) =>
        record.get("status") === "active" && (asMillis(record.get("expiresAt")) ?? 0) > now),
      quarantinedFileCount: sampleCount(documents, (record) =>
        record.get("scanStatus") !== "CLEAN"),
      integrationKeyCount: integrationCredentials === null ? null : integrationCredentials.length,
      dangerousRoleGrantCount: sampleCount(roles, (record) => {
        const grants = record.get("permissions");
        return Array.isArray(grants) && grants.some((grant) => grant && dangerousKeys.has(grant.key));
      }),
    });

    return NextResponse.json({
      observedAt: new Date().toISOString(),
      sampleLimit: SAMPLE_LIMIT,
      capabilities: {
        manageIncidents: context.grants.some((grant) => grant.key === "security.incident.manage"),
        containIncidents: context.grants.some((grant) => grant.key === "security.incident.contain"),
      },
      postureChecks: checks,
      incidents: pageDocs.map((snapshot) => incidentResponseForAccess(
        snapshot,
        context.grants.some((grant) => grant.key === "security.incident.manage"),
      )),
      nextCursor,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const raw = await request.json() as Record<string, unknown>;
    const action = raw.action;
    const permissionKey = action === "transition" ? "security.incident.manage"
      : action === "contain_sessions" ? "security.incident.contain" : "security.incident.manage";
    const context = await requirePermission(request, permissionKey, {}, { stepUp: true });
    if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");

    const idempotencyKey = typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.trim() : "";
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
      return NextResponse.json({ error: "A valid idempotency key is required." }, { status: 400 });
    }

    if (action === "create_draft") {
      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
      const severity = raw.severity as SecurityIncidentSeverity;
      if (!title || title.length > 140 || summary.length < 8 || summary.length > 2000 || !validSeverities.has(severity)) {
        return NextResponse.json({ error: "Provide a title, an 8–2000 character summary, and a valid severity." }, { status: 400 });
      }
      const requestHash = createHash("sha256").update(JSON.stringify({ action, title, summary, severity })).digest("hex");
      const keyHash = createHash("sha256").update(`${context.uid}:${idempotencyKey}`).digest("hex");
      const idempotencyRef = adminDb.collection("securityIdempotency").doc(keyHash);
      const incidentRef = adminDb.collection("securityIncidents").doc(randomUUID());
      const eventRef = incidentRef.collection("timeline").doc();
      const auditRef = adminDb.collection("securityAuditEvents").doc();
      const result = await adminDb.runTransaction(async (transaction) => {
        const existing = await transaction.get(idempotencyRef);
        if (existing.exists) {
          if (existing.get("requestHash") !== requestHash
            || existing.get("institutionId") !== context.institutionId) throw new Error("CONFLICT");
          return { incidentId: existing.get("incidentId") as string, duplicate: true };
        }
        transaction.create(incidentRef, {
          incidentId: incidentRef.id,
          institutionId: context.institutionId,
          title,
          summary,
          severity,
          sensitivity: "RESTRICTED",
          status: "draft",
          version: 1,
          module: "security-center",
          sourceType: "manual",
          sourceId: "manual-report",
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
          schemaVersion: 1,
        });
        transaction.create(eventRef, {
          eventId: eventRef.id,
          institutionId: context.institutionId,
          incidentId: incidentRef.id,
          action: "draft_created",
          reason: summary,
          actorUid: context.uid,
          previousState: null,
          newState: "draft",
          status: "recorded",
          module: "security-center",
          sourceType: "securityIncident",
          sourceId: incidentRef.id,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
          schemaVersion: 1,
        });
        transaction.create(auditRef, {
          eventId: auditRef.id,
          institutionId: context.institutionId,
          actorUid: context.uid,
          action: "security.incident.draft_created",
          where: "security-center",
          reference: incidentRef.id,
          result: "success",
          previousState: null,
          newState: "draft",
          reason: summary,
          status: "recorded",
          module: "security-center",
          sourceType: "securityIncident",
          sourceId: incidentRef.id,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
          schemaVersion: 1,
        });
        transaction.create(idempotencyRef, {
          institutionId: context.institutionId,
          actorUid: context.uid,
          action,
          incidentId: incidentRef.id,
          requestHash,
          result: { incidentId: incidentRef.id },
          status: "completed",
          module: "security-center",
          sourceType: "securityIncident",
          sourceId: incidentRef.id,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
          schemaVersion: 1,
        });
        return { incidentId: incidentRef.id, duplicate: false };
      });
      return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
    }

    if (action === "contain_sessions") {
      const incidentId = typeof raw.incidentId === "string" ? raw.incidentId.trim() : "";
      const targetUid = typeof raw.targetUid === "string" ? raw.targetUid.trim() : "";
      const expectedVersion = raw.expectedVersion;
      const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
      if (!incidentId || !targetUid || typeof expectedVersion !== "number"
        || !Number.isSafeInteger(expectedVersion) || reason.length < 8 || reason.length > 500) {
        return NextResponse.json({ error: "Incident, target user, version, and a reason of at least 8 characters are required." }, { status: 400 });
      }
      const result = await containUserSessions({
        institutionId: context.institutionId,
        actorUid: context.uid,
        uid: targetUid,
        incidentId,
        expectedVersion,
        reason,
        idempotencyKey,
      });
      return NextResponse.json(result, { status: result.duplicate ? 200 : 200 });
    }

    if (action === "transition") {
      const incidentId = typeof raw.incidentId === "string" ? raw.incidentId : "";
      const expectedVersion = raw.expectedVersion;
      const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
      const nextStatus = raw.nextStatus as SecurityIncidentStatus;
      if (!incidentId || typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || reason.length < 8 || reason.length > 500
        || !SECURITY_INCIDENT_STATUSES.includes(nextStatus)) {
        return NextResponse.json({ error: "Incident, version, next status, and a reason of at least 8 characters are required." }, { status: 400 });
      }
      const requestHash = createHash("sha256").update(JSON.stringify({ action, incidentId, expectedVersion, nextStatus, reason })).digest("hex");
      const keyHash = createHash("sha256").update(`${context.uid}:${idempotencyKey}`).digest("hex");
      const idempotencyRef = adminDb.collection("securityIdempotency").doc(keyHash);
      const incidentRef = adminDb.collection("securityIncidents").doc(incidentId);
      const eventRef = incidentRef.collection("timeline").doc();
      const auditRef = adminDb.collection("securityAuditEvents").doc();
      const result = await adminDb.runTransaction(async (transaction) => {
        const [existing, incident] = await transaction.getAll(idempotencyRef, incidentRef);
        if (existing.exists) {
          if (existing.get("requestHash") !== requestHash
            || existing.get("institutionId") !== context.institutionId) throw new Error("CONFLICT");
          return { incidentId, status: existing.get("result.status") as SecurityIncidentStatus, duplicate: true };
        }
        if (!incident.exists || incident.get("institutionId") !== context.institutionId) throw new Error("FORBIDDEN");
        if (incident.get("version") !== expectedVersion) throw new Error("CONFLICT");
        const previousState = canonicalIncidentStatus(incident.get("status"));
        const status = transitionSecurityIncident(previousState, nextStatus, reason);
        const version = Number(expectedVersion) + 1;
        transaction.update(incidentRef, {
          status,
          version,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
        });
        transaction.create(eventRef, {
          eventId: eventRef.id,
          institutionId: context.institutionId,
          incidentId,
          action: "status_transition",
          reason,
          actorUid: context.uid,
          previousState,
          newState: status,
          status: "recorded",
          module: "security-center",
          sourceType: "securityIncident",
          sourceId: incidentId,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
          schemaVersion: 1,
        });
        transaction.create(auditRef, {
          eventId: auditRef.id,
          institutionId: context.institutionId,
          actorUid: context.uid,
          action: "security.incident.transitioned",
          where: "security-center",
          reference: incidentId,
          result: "success",
          previousState,
          newState: status,
          reason,
          status: "recorded",
          module: "security-center",
          sourceType: "securityIncident",
          sourceId: incidentId,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
          schemaVersion: 1,
        });
        transaction.create(idempotencyRef, {
          institutionId: context.institutionId,
          actorUid: context.uid,
          action,
          incidentId,
          requestHash,
          result: { incidentId, status },
          status: "completed",
          module: "security-center",
          sourceType: "securityIncident",
          sourceId: incidentId,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
          schemaVersion: 1,
        });
        return { incidentId, status, version, duplicate: false };
      });
      return NextResponse.json(result, { status: 200 });
    }

    return NextResponse.json({ error: "Unsupported Security Center action." }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid incident transition:")) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error && error.message.includes("Reopening an incident requires")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return failure(error);
  }
}
