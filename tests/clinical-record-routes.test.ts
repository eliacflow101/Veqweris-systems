import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { after, before, test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";

const projectId = "demo-veqweris-clinical-record-routes";
const runId = randomUUID().replace(/-/g, "").slice(0, 12);
const institutionId = `clinical-${runId}-a`;
const otherInstitutionId = `clinical-${runId}-b`;
const patientId = `patient-${runId}`;
const otherPatientId = `patient-other-${runId}`;
const unassignedPatientId = `patient-unassigned-${runId}`;
const encounterId = `encounter-${runId}`;
const otherEncounterId = `encounter-other-${runId}`;
const departmentId = `department-${runId}`;
const outsideDepartmentId = `outside-${runId}`;
const locationId = `location-${runId}`;
const outsideLocationId = `outside-location-${runId}`;
const unitId = `unit-${runId}`;
const outsideUnitId = `outside-unit-${runId}`;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

process.env.FIREBASE_PROJECT_ID = projectId;
process.env.FIREBASE_CLIENT_EMAIL = "clinical-record-tests@demo-veqweris-clinical-record-routes.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";

type TestAccount = { uid: string; token: string; role: string };
type ClinicalRoutes = typeof import("../app/api/healthcare/clinical-records/route");
type ClinicalRecordRoutes = typeof import("../app/api/healthcare/clinical-records/[clinicalRecordId]/route");
let db: import("firebase-admin/firestore").Firestore;
let auth: import("firebase-admin/auth").Auth;
let adminRoutes: ClinicalRoutes;
let updateRoutes: ClinicalRecordRoutes;
let sessionTokenHash: (token: string) => string;
let compileStaffAuthorization: typeof import("../lib/permissions/server").compileStaffAuthorization;
let accounts: Record<string, TestAccount>;

async function fetchRoute(url: string, method: string, token?: string, body?: Record<string, unknown>) {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function createAuthAccount(role: "Employee" | "Admin" | "Owner", permissions: Array<{
  key: "health.record.read" | "health.record.write";
  scope?: Record<string, unknown>;
}>, assignedPatients: string[] = [patientId], specialtyId?: string): Promise<TestAccount> {
  const email = `clinical-${runId}-${role}-${Object.keys(accounts).length}@example.test`;
  const password = "Veqweris-Clinical-Test-1!";
  const signupResponse = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=clinical-route-tests`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const signupBody = await signupResponse.text();
  assert.equal(signupResponse.status, 200, `Auth emulator account creation failed: ${signupBody}`);
  const signup = JSON.parse(signupBody) as { localId: string };
  const roleId = `clinical-role-${runId}-${Object.keys(accounts).length}`;
  await db.collection("users").doc(signup.localId).set({
    uid: signup.localId,
    institutionId,
    role,
    status: "active",
    assignedPatientIds: assignedPatients,
    ...(specialtyId ? { specialtyId } : {}),
  });
  await db.collection("memberships").doc(signup.localId).set({
    institutionId,
    tier: role,
    roleIds: permissions.length ? [roleId] : [],
    departmentIds: role === "Employee" ? [departmentId] : [],
    unitIds: role === "Employee" ? [unitId] : [],
    teamIds: [],
    locationIds: role === "Employee" ? [locationId] : [],
    permissionVersion: 1,
    sensitivityCeiling: "RESTRICTED",
    status: "active",
  });
  if (permissions.length) {
    await db.collection("roles").doc(roleId).set({
      roleId,
      institutionId,
      tierCeiling: role,
      permissions,
      status: "active",
      version: 1,
    });
  }
  await compileStaffAuthorization(signup.localId);
  const signinResponse = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=clinical-route-tests`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const signinBody = await signinResponse.text();
  assert.equal(signinResponse.status, 200, `Auth emulator sign-in failed: ${signinBody}`);
  const signin = JSON.parse(signinBody) as { idToken: string };
  await db.collection("securitySessions").doc(sessionTokenHash(signin.idToken)).set({
    uid: signup.localId,
    institutionId,
    status: "active",
    expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
  });
  return { uid: signup.localId, token: signin.idToken, role };
}

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: `create-${runId}-000001`,
    patientId,
    encounterId,
    recordType: "note",
    summary: "Clinical route integration test.",
    sensitivity: "sensitive",
    specialtyId: "cardiology",
    locationId,
    unitId,
    departmentId,
    ...overrides,
  };
}

before(async () => {
  const admin = await import("../lib/firebase/admin");
  const authModule = await import("../lib/firebase/server-auth");
  const permissions = await import("../lib/permissions/server");
  assert.ok(admin.adminDb && admin.adminAuth, "Firebase Admin emulator configuration is required.");
  db = admin.adminDb;
  db.settings({ preferRest: true });
  auth = admin.adminAuth;
  sessionTokenHash = authModule.sessionTokenHash;
  compileStaffAuthorization = permissions.compileStaffAuthorization;
  adminRoutes = await import("../app/api/healthcare/clinical-records/route");
  updateRoutes = await import("../app/api/healthcare/clinical-records/[clinicalRecordId]/route");
  accounts = {};

  const fixtures: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [
    { collection: "institutions", id: institutionId, data: {
      institutionId, name: institutionId, country: "Test", status: "active",
      planTier: "enterprise", relationship: "Customer",
    } },
    { collection: "institutions", id: otherInstitutionId, data: {
      institutionId: otherInstitutionId, name: otherInstitutionId, country: "Test", status: "active",
      planTier: "enterprise", relationship: "Customer",
    } },
    { collection: "patientIdentities", id: patientId, data: {
      patientId, institutionId, patientNumber: `P-${runId}`, fullName: "Test Patient",
      status: "active", createdAt: Timestamp.now(),
    } },
    { collection: "patientIdentities", id: otherPatientId, data: {
      patientId: otherPatientId, institutionId: otherInstitutionId, patientNumber: `PX-${runId}`,
      fullName: "Other Institution Patient", status: "active", createdAt: Timestamp.now(),
    } },
    { collection: "healthcareEncounters", id: encounterId, data: {
      encounterId, institutionId, patientId, encounterType: "outpatient", status: "open",
      createdAt: Timestamp.now(),
    } },
    { collection: "healthcareEncounters", id: otherEncounterId, data: {
      encounterId: otherEncounterId, institutionId: otherInstitutionId, patientId: otherPatientId,
      encounterType: "outpatient", status: "open", createdAt: Timestamp.now(),
    } },
    { collection: "departments", id: departmentId, data: { departmentId, institutionId, name: departmentId } },
    { collection: "departments", id: outsideDepartmentId, data: { departmentId: outsideDepartmentId, institutionId, name: outsideDepartmentId } },
    { collection: "locations", id: locationId, data: { locationId, institutionId, name: locationId } },
    { collection: "locations", id: outsideLocationId, data: { locationId: outsideLocationId, institutionId, name: outsideLocationId } },
    { collection: "operationalUnits", id: unitId, data: { unitId, institutionId, name: unitId } },
    { collection: "operationalUnits", id: outsideUnitId, data: { unitId, institutionId, name: outsideUnitId } },
  ];
  for (const fixture of fixtures) {
    await db.collection(fixture.collection).doc(fixture.id).set(fixture.data);
  }
  accounts.writer = await createAuthAccount("Employee", [{
    key: "health.record.write",
    scope: {
      locationIds: [locationId], unitIds: [unitId], departmentIds: [departmentId],
      sensitivityCeiling: "RESTRICTED",
    },
  }], [patientId], "cardiology");
  accounts.readOnly = await createAuthAccount("Employee", [{
    key: "health.record.read",
  }], [patientId], "cardiology");
  accounts.admin = await createAuthAccount("Admin", []);
  accounts.owner = await createAuthAccount("Owner", []);
  accounts.unassigned = await createAuthAccount("Employee", [{
    key: "health.record.write",
    scope: {
      locationIds: [locationId], unitIds: [unitId], departmentIds: [departmentId],
      sensitivityCeiling: "RESTRICTED",
    },
  }], [], "cardiology");
});

after(async () => {
  const documents: Array<[string, string]> = [
    ["institutions", institutionId], ["institutions", otherInstitutionId],
    ["clinicalRecords", `read-cross-tenant-${runId}`],
    ["patientIdentities", patientId], ["patientIdentities", otherPatientId],
    ["healthcareEncounters", encounterId], ["healthcareEncounters", otherEncounterId],
    ["departments", departmentId], ["departments", outsideDepartmentId],
    ["locations", locationId], ["locations", outsideLocationId],
    ["operationalUnits", unitId], ["operationalUnits", outsideUnitId],
  ];
  for (const account of Object.values(accounts ?? {})) {
    documents.push(
      ["users", account.uid], ["memberships", account.uid], ["effectivePermissions", account.uid],
      ["securitySessions", sessionTokenHash(account.token)],
    );
    const membership = await db.collection("memberships").doc(account.uid).get();
    for (const roleId of membership.get("roleIds") ?? []) documents.push(["roles", roleId as string]);
  }
  const records = await db.collection("clinicalRecords").where("institutionId", "==", institutionId).get();
  const audits = await db.collection("clinicalAuditEvents").where("institutionId", "==", institutionId).get();
  const idempotency = await db.collection("requestIdempotency").where("institutionId", "==", institutionId).get();
  const readCursors = await db.collection("clinicalRecordReadCursors").where("institutionId", "==", institutionId).get();
  await Promise.all([
    ...documents.map(([collection, id]) => db.collection(collection).doc(id).delete()),
    ...records.docs.map((snapshot) => snapshot.ref.delete()),
    ...audits.docs.map((snapshot) => snapshot.ref.delete()),
    ...idempotency.docs.map((snapshot) => snapshot.ref.delete()),
    ...readCursors.docs.map((snapshot) => snapshot.ref.delete()),
  ]);
  await Promise.all((await auth.listUsers(1000)).users
    .filter((user) => user.email?.startsWith(`clinical-${runId}-`))
    .map((user) => auth.deleteUser(user.uid)));
  const { getApps, deleteApp } = await import("firebase-admin/app");
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

test("authorized scoped writer creates and idempotently replays an audited record", async () => {
  const request = await fetchRoute("/api/healthcare/clinical-records", "POST", accounts.writer.token, createPayload());
  const response = await adminRoutes.POST(request);
  assert.equal(response.status, 201, await response.clone().text());
  const result = await response.json() as { clinicalRecordId: string; replay: boolean };
  assert.equal(result.replay, false);
  const record = await db.collection("clinicalRecords").doc(result.clinicalRecordId).get();
  assert.equal(record.get("institutionId"), institutionId);
  assert.equal(record.get("patientId"), patientId);
  assert.equal(record.get("authoredBy"), accounts.writer.uid);
  assert.equal(record.get("departmentId"), departmentId);
  const auditBeforeReplay = await db.collection("clinicalAuditEvents")
    .where("clinicalRecordId", "==", result.clinicalRecordId).get();
  assert.equal(auditBeforeReplay.size, 1);

  const replayRequest = await fetchRoute(
    "/api/healthcare/clinical-records", "POST", accounts.writer.token, createPayload(),
  );
  const replayResponse = await adminRoutes.POST(replayRequest);
  assert.equal(replayResponse.status, 200, await replayResponse.clone().text());
  const replay = await replayResponse.json() as { clinicalRecordId: string; replay: boolean };
  assert.deepEqual(replay, { clinicalRecordId: result.clinicalRecordId, replay: true });
  const auditAfterReplay = await db.collection("clinicalAuditEvents")
    .where("clinicalRecordId", "==", result.clinicalRecordId).get();
  assert.equal(auditAfterReplay.size, 1);
});

test("read-only users and Owner/Admin tiers without explicit write grants cannot create records", async () => {
  for (const account of [accounts.readOnly, accounts.owner, accounts.admin]) {
    const response = await adminRoutes.POST(await fetchRoute(
      "/api/healthcare/clinical-records", "POST", account.token,
      createPayload({ idempotencyKey: `denied-${runId}-${account.role}-0001` }),
    ));
    assert.equal(response.status, 403);
  }
});

test("clinical reads enforce scopes server-side and pagination cannot bypass them", async () => {
  const authorizedIds = Array.from({ length: 28 }, (_, index) => `read-${runId}-${String(index).padStart(2, "0")}`);
  const records = authorizedIds.map((clinicalRecordId) => ({
    clinicalRecordId,
    institutionId,
    patientId,
    encounterId,
    recordType: "note",
    summary: "Authorized route read fixture.",
    sensitivity: "sensitive",
    specialtyId: "cardiology",
    locationId,
    unitId,
    departmentId,
    authoredBy: accounts.writer.uid,
    createdAt: Timestamp.now(),
    internalMarker: "must-not-be-returned",
  }));
  await Promise.all(records.map((record) =>
    db.collection("clinicalRecords").doc(record.clinicalRecordId).set(record)));
  const deniedRecords = [
    {
      clinicalRecordId: `read-unassigned-${runId}`,
      institutionId,
      patientId: unassignedPatientId,
      encounterId,
      recordType: "note",
      summary: "Unassigned patient record.",
      sensitivity: "sensitive",
      specialtyId: "cardiology",
      locationId,
      unitId,
      departmentId,
      authoredBy: accounts.writer.uid,
      createdAt: Timestamp.now(),
    },
    {
      clinicalRecordId: `read-unscoped-${runId}`,
      institutionId,
      patientId,
      encounterId,
      recordType: "note",
      summary: "Outside resource scope.",
      sensitivity: "sensitive",
      specialtyId: "cardiology",
      locationId: outsideLocationId,
      unitId,
      departmentId,
      authoredBy: accounts.writer.uid,
      createdAt: Timestamp.now(),
    },
    {
      clinicalRecordId: `read-specialty-${runId}`,
      institutionId,
      patientId,
      encounterId,
      recordType: "note",
      summary: "Outside specialty.",
      sensitivity: "sensitive",
      specialtyId: "neurology",
      locationId,
      unitId,
      departmentId,
      authoredBy: accounts.writer.uid,
      createdAt: Timestamp.now(),
    },
    {
      clinicalRecordId: `read-cross-tenant-${runId}`,
      institutionId: otherInstitutionId,
      patientId,
      encounterId,
      recordType: "note",
      summary: "Other tenant record.",
      sensitivity: "sensitive",
      specialtyId: "cardiology",
      locationId,
      unitId,
      departmentId,
      authoredBy: accounts.writer.uid,
      createdAt: Timestamp.now(),
    },
  ];
  await Promise.all(deniedRecords.map((record) =>
    db.collection("clinicalRecords").doc(record.clinicalRecordId).set(record)));

  const firstResponse = await adminRoutes.GET(
    await fetchRoute("/api/healthcare/clinical-records", "GET", accounts.readOnly.token),
  );
  assert.equal(firstResponse.status, 200, await firstResponse.clone().text());
  const firstPage = await firstResponse.json() as {
    records: Array<Record<string, unknown> & { clinicalRecordId: string }>;
    nextCursor: string | null;
    canRead: boolean;
    canWrite: boolean;
  };
  assert.equal(firstPage.canRead, true);
  assert.equal(firstPage.canWrite, false);
  assert.equal(firstPage.records.length, 25);
  assert.ok(firstPage.nextCursor);
  assert.ok(firstPage.records.every((record) => !("internalMarker" in record)));
  const reusedCursorResponse = await adminRoutes.GET(await fetchRoute(
    `/api/healthcare/clinical-records?cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    "GET",
    accounts.owner.token,
  ));
  assert.equal(reusedCursorResponse.status, 409, "a cursor cannot be reused by another signed-in user");
  const malformedCursorResponse = await adminRoutes.GET(await fetchRoute(
    "/api/healthcare/clinical-records?cursor=",
    "GET",
    accounts.readOnly.token,
  ));
  assert.equal(malformedCursorResponse.status, 400);

  const seen = new Set(firstPage.records.map((record) => record.clinicalRecordId));
  let cursor: string | null = firstPage.nextCursor;
  let pageCount = 1;
  while (cursor && pageCount < 5) {
    const response = await adminRoutes.GET(await fetchRoute(
      `/api/healthcare/clinical-records?cursor=${encodeURIComponent(cursor)}`,
      "GET",
      accounts.readOnly.token,
    ));
    assert.equal(response.status, 200, await response.clone().text());
    const page = await response.json() as typeof firstPage;
    page.records.forEach((record) => seen.add(record.clinicalRecordId));
    cursor = page.nextCursor;
    pageCount += 1;
  }
  assert.equal(cursor, null);
  assert.ok(authorizedIds.every((id) => seen.has(id)));
  assert.ok(deniedRecords.every((record) => !seen.has(record.clinicalRecordId)));
  const readAudits = await db.collection("clinicalAuditEvents")
    .where("actorUid", "==", accounts.readOnly.uid)
    .where("operation", "==", "read")
    .get();
  assert.ok(readAudits.size >= 2, "each successful clinical-record page is audited");
  assert.ok(readAudits.docs.every((audit) =>
    audit.get("permission") === "health.record.read"
    && Array.isArray(audit.get("clinicalRecordIds"))
    && !("summary" in (audit.data() ?? {}))
    && !("patientId" in (audit.data() ?? {}))));

  const writerResponse = await adminRoutes.GET(
    await fetchRoute("/api/healthcare/clinical-records", "GET", accounts.writer.token),
  );
  assert.equal(writerResponse.status, 200);
  const writerBody = await writerResponse.json() as { records: unknown[]; canRead: boolean; canWrite: boolean };
  assert.deepEqual(writerBody.records, []);
  assert.equal(writerBody.canRead, false, "write permission does not imply read permission");
  assert.equal(writerBody.canWrite, true);

  const unauthorizedResponse = await adminRoutes.GET(
    await fetchRoute("/api/healthcare/clinical-records", "GET", accounts.admin.token),
  );
  assert.equal(unauthorizedResponse.status, 403);
  const unauthenticatedResponse = await adminRoutes.GET(
    await fetchRoute("/api/healthcare/clinical-records", "GET"),
  );
  assert.equal(unauthenticatedResponse.status, 401);
});

test("write authorization enforces patient, specialty, and resource scope", async () => {
  const cases: Array<{ name: string; payload: Record<string, unknown>; status: number }> = [
    { name: "unassigned patient", payload: createPayload({ idempotencyKey: `scope-${runId}-patient-01`, patientId: `missing-${runId}` }), status: 404 },
    { name: "cross-institution patient", payload: createPayload({ idempotencyKey: `scope-${runId}-patient-03`, patientId: otherPatientId, encounterId: otherEncounterId }), status: 404 },
    { name: "missing patient id", payload: createPayload({ idempotencyKey: `scope-${runId}-patient-02`, patientId: "" }), status: 400 },
    { name: "different specialty", payload: createPayload({ idempotencyKey: `scope-${runId}-specialty-01`, specialtyId: "neurology" }), status: 403 },
    { name: "missing specialty", payload: createPayload({ idempotencyKey: `scope-${runId}-specialty-02`, specialtyId: undefined }), status: 403 },
    { name: "outside department", payload: createPayload({ idempotencyKey: `scope-${runId}-dept-01`, departmentId: outsideDepartmentId }), status: 403 },
    { name: "missing restricted department", payload: createPayload({ idempotencyKey: `scope-${runId}-dept-02`, departmentId: undefined }), status: 403 },
    { name: "outside location", payload: createPayload({ idempotencyKey: `scope-${runId}-location-01`, locationId: outsideLocationId }), status: 403 },
    { name: "missing restricted location", payload: createPayload({ idempotencyKey: `scope-${runId}-location-02`, locationId: undefined }), status: 403 },
    { name: "outside unit", payload: createPayload({ idempotencyKey: `scope-${runId}-unit-01`, unitId: outsideUnitId }), status: 403 },
    { name: "missing restricted unit", payload: createPayload({ idempotencyKey: `scope-${runId}-unit-02`, unitId: undefined }), status: 403 },
  ];
  for (const testCase of cases) {
    const response = await adminRoutes.POST(await fetchRoute(
      "/api/healthcare/clinical-records", "POST", accounts.writer.token, testCase.payload,
    ));
    assert.equal(response.status, testCase.status, testCase.name);
  }
  const unassignedResponse = await adminRoutes.POST(await fetchRoute(
    "/api/healthcare/clinical-records", "POST", accounts.unassigned.token,
    createPayload({ idempotencyKey: `scope-${runId}-assignment-01` }),
  ));
  assert.equal(unassignedResponse.status, 403, "the assigned-patient list is enforced");
});

test("authorized updates preserve protected identity and audit atomically", async () => {
  const createRequest = await fetchRoute(
    "/api/healthcare/clinical-records", "POST", accounts.writer.token,
    createPayload({ idempotencyKey: `update-${runId}-create-0001` }),
  );
  const createResponse = await adminRoutes.POST(createRequest);
  assert.equal(createResponse.status, 201, await createResponse.clone().text());
  const { clinicalRecordId } = await createResponse.json() as { clinicalRecordId: string };

  const patch = { idempotencyKey: `update-${runId}-patch-0001`, summary: "Updated clinical note." };
  const response = await updateRoutes.PATCH(
    await fetchRoute(`/api/healthcare/clinical-records/${clinicalRecordId}`, "PATCH", accounts.writer.token, patch),
    { params: Promise.resolve({ clinicalRecordId }) },
  );
  assert.equal(response.status, 200, await response.clone().text());
  const record = await db.collection("clinicalRecords").doc(clinicalRecordId).get();
  assert.equal(record.get("summary"), patch.summary);
  assert.equal(record.get("patientId"), patientId);
  assert.ok(record.get("updatedAt") instanceof Timestamp);
  assert.equal((await db.collection("clinicalAuditEvents").where("clinicalRecordId", "==", clinicalRecordId).get()).size, 2);

  for (const account of [accounts.readOnly, accounts.owner, accounts.admin]) {
    const denied = await updateRoutes.PATCH(
      await fetchRoute(`/api/healthcare/clinical-records/${clinicalRecordId}`, "PATCH", account.token, {
        idempotencyKey: `update-${runId}-denied-${account.role}`,
        summary: "Should not be applied.",
      }),
      { params: Promise.resolve({ clinicalRecordId }) },
    );
    assert.equal(denied.status, 403, `${account.role} cannot update without an explicit write grant`);
  }

  const forbiddenPatch = await updateRoutes.PATCH(
    await fetchRoute(`/api/healthcare/clinical-records/${clinicalRecordId}`, "PATCH", accounts.writer.token, {
      idempotencyKey: `update-${runId}-patch-0002`, patientId: `other-${runId}`,
    }),
    { params: Promise.resolve({ clinicalRecordId }) },
  );
  assert.equal(forbiddenPatch.status, 400, "patient identity cannot be patched");
});

test("missing authentication, stale permissions, and disabled healthcare entitlement fail closed", async () => {
  const unauthenticated = await adminRoutes.POST(await fetchRoute(
    "/api/healthcare/clinical-records", "POST", undefined,
    createPayload({ idempotencyKey: `auth-${runId}-missing-0001` }),
  ));
  assert.equal(unauthenticated.status, 401);

  await db.collection("effectivePermissions").doc(accounts.writer.uid).delete();
  const stale = await adminRoutes.POST(await fetchRoute(
    "/api/healthcare/clinical-records", "POST", accounts.writer.token,
    createPayload({ idempotencyKey: `auth-${runId}-stale-0001` }),
  ));
  assert.equal(stale.status, 409);
  await compileStaffAuthorization(accounts.writer.uid);

  await db.collection("institutions").doc(institutionId).update({ planTier: "basic" });
  try {
    const disabled = await adminRoutes.POST(await fetchRoute(
      "/api/healthcare/clinical-records", "POST", accounts.writer.token,
      createPayload({ idempotencyKey: `auth-${runId}-module-0001` }),
    ));
    assert.equal(disabled.status, 403);
  } finally {
    await db.collection("institutions").doc(institutionId).update({ planTier: "enterprise" });
  }
});
