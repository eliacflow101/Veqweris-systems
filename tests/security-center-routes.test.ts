import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { after, before, test } from "node:test";
import { Timestamp } from "firebase-admin/firestore";

const projectId = "demo-veqweris-security-center-routes";
const runId = randomUUID().replace(/-/g, "").slice(0, 10);
const institutionA = `security-${runId}-a`;
const institutionB = `security-${runId}-b`;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

process.env.FIREBASE_PROJECT_ID = projectId;
process.env.FIREBASE_CLIENT_EMAIL = "security-center-tests@demo-veqweris-security-center-routes.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";

type TestAccount = { uid: string; token: string; email: string };
let db: import("firebase-admin/firestore").Firestore;
let auth: import("firebase-admin/auth").Auth;
let sessionTokenHash: (token: string) => string;
let compileStaffAuthorization: typeof import("../lib/permissions/server").compileStaffAuthorization;
let routes: typeof import("../app/api/security-center/route");
let authorized: TestAccount;
let postureReader: TestAccount;
let unauthorized: TestAccount;
let target: TestAccount;
let otherTenant: TestAccount;

async function createAccount(
  label: string,
  institutionId: string,
  role: "Owner" | "Admin" | "Employee",
  permissions: string[],
): Promise<TestAccount> {
  const email = `security-${runId}-${label}@example.test`;
  const password = "Veqweris-Security-Test-1!";
  const signupResponse = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=security-center-tests`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const signupText = await signupResponse.text();
  assert.equal(signupResponse.status, 200, `Auth emulator account creation failed: ${signupText}`);
  const signup = JSON.parse(signupText) as { localId: string };
  await db.collection("users").doc(signup.localId).set({
    uid: signup.localId,
    institutionId,
    role,
    status: "active",
    departmentId: "department-a",
  });
  const roleId = `security-role-${runId}-${label}`;
  await db.collection("memberships").doc(signup.localId).set({
    institutionId,
    tier: role,
    roleIds: permissions.length ? [roleId] : [],
    departmentIds: role === "Employee" ? ["department-a"] : [],
    unitIds: [],
    teamIds: [],
    locationIds: [],
    permissionVersion: 1,
    sensitivityCeiling: "RESTRICTED",
    status: "active",
  });
  if (permissions.length) {
    await db.collection("roles").doc(roleId).set({
      roleId,
      institutionId,
      tierCeiling: role === "Employee" ? "Employee" : role,
      permissions: permissions.map((key) => ({ key, scope: { institutionId } })),
      status: "active",
      version: 1,
    });
  }
  await compileStaffAuthorization(signup.localId);
  const signinResponse = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=security-center-tests`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const signinText = await signinResponse.text();
  assert.equal(signinResponse.status, 200, `Auth emulator sign-in failed: ${signinText}`);
  const signin = JSON.parse(signinText) as { idToken: string };
  await db.collection("securitySessions").doc(sessionTokenHash(signin.idToken)).set({
    uid: signup.localId,
    institutionId,
    status: "active",
    expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
  });
  return { uid: signup.localId, email, token: signin.idToken };
}

function routeRequest(method: "GET" | "POST", account?: TestAccount, body?: Record<string, unknown>, url = "http://localhost/api/security-center") {
  const headers = new Headers();
  if (account) headers.set("authorization", `Bearer ${account.token}`);
  if (body) headers.set("content-type", "application/json");
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

async function post(account: TestAccount, body: Record<string, unknown>) {
  return routes.POST(routeRequest("POST", account, body));
}

before(async () => {
  const admin = await import("../lib/firebase/admin");
  const authModule = await import("../lib/firebase/server-auth");
  const permissions = await import("../lib/permissions/server");
  routes = await import("../app/api/security-center/route");
  assert.ok(admin.adminDb && admin.adminAuth, "Firebase Admin emulator configuration is required.");
  db = admin.adminDb;
  db.settings({ preferRest: true });
  auth = admin.adminAuth;
  sessionTokenHash = authModule.sessionTokenHash;
  compileStaffAuthorization = permissions.compileStaffAuthorization;
  await Promise.all([institutionA, institutionB].map((institutionId) =>
    db.collection("institutions").doc(institutionId).set({
      institutionId,
      name: institutionId,
      status: "active",
      planTier: "enterprise",
      relationship: "Customer",
    })));
  const securityPermissions = ["security.center.read", "security.incident.manage", "security.incident.contain"];
  authorized = await createAccount("authorized", institutionA, "Admin", securityPermissions);
  postureReader = await createAccount("posture-reader", institutionA, "Admin", ["security.center.read"]);
  unauthorized = await createAccount("unauthorized", institutionA, "Owner", []);
  target = await createAccount("target", institutionA, "Employee", []);
  otherTenant = await createAccount("other-tenant", institutionB, "Admin", securityPermissions);
});

after(async () => {
  const { getApps, deleteApp } = await import("firebase-admin/app");
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

test("Security Center requires explicit effective permission and returns bounded evidence", async () => {
  const denied = await routes.GET(routeRequest("GET", unauthorized));
  assert.equal(denied.status, 403);
  const anonymous = await routes.GET(routeRequest("GET"));
  assert.equal(anonymous.status, 401);

  const response = await routes.GET(routeRequest("GET", authorized));
  assert.equal(response.status, 200);
  const body = await response.json() as {
    postureChecks: Array<{ checkId: string; status: string; evidence: string }>;
    sampleLimit: number;
    capabilities: { manageIncidents: boolean; containIncidents: boolean };
    incidents: unknown[];
  };
  assert.equal(body.sampleLimit, 25);
  assert.equal(body.postureChecks.length, 12);
  assert.ok(body.postureChecks.some((check) => check.checkId === "failed-signins" && check.status === "Not Enough Data"));
  assert.ok(body.postureChecks.every((check) => check.status !== "Healthy"));
  assert.deepEqual(body.capabilities, { manageIncidents: true, containIncidents: true });

  await db.collection("securityIncidents").doc(`restricted-${runId}`).set({
    institutionId: institutionA,
    title: "Confidential incident title",
    summary: "Confidential incident details must not reach posture-only users.",
    severity: "critical",
    status: "OPEN",
    version: 1,
    updatedAt: Timestamp.now(),
    createdAt: Timestamp.now(),
  });
  const restrictedResponse = await routes.GET(routeRequest("GET", postureReader));
  assert.equal(restrictedResponse.status, 200);
  const restrictedBody = await restrictedResponse.json() as {
    capabilities: { manageIncidents: boolean };
    incidents: Array<{ title: string; summary: string; severity: string }>;
  };
  assert.equal(restrictedBody.capabilities.manageIncidents, false);
  assert.ok(restrictedBody.incidents.every((incident) =>
    incident.title !== "Confidential incident title"
    && !incident.summary.includes("Confidential incident details")
    && incident.severity !== "critical"));
});

test("incident drafts are tenant-scoped, audited, and idempotent", async () => {
  const payload = {
    action: "create_draft",
    idempotencyKey: `stage28-create-${runId}-0001`,
    title: "Test incident",
    summary: "A non-sensitive incident fixture for route validation.",
    severity: "moderate",
  };
  const first = await post(authorized, payload);
  assert.equal(first.status, 201);
  const created = await first.json() as { incidentId: string; duplicate: boolean };
  assert.equal(created.duplicate, false);

  const replay = await post(authorized, payload);
  assert.equal(replay.status, 200);
  const replayed = await replay.json() as { incidentId: string; duplicate: boolean };
  assert.equal(replayed.incidentId, created.incidentId);
  assert.equal(replayed.duplicate, true);

  const conflictingReplay = await post(authorized, { ...payload, title: "Conflicting intent" });
  assert.equal(conflictingReplay.status, 409);

  const denied = await post(unauthorized, { ...payload, idempotencyKey: `stage28-denied-${runId}-0001` });
  assert.equal(denied.status, 403);
  const crossTenant = await post(otherTenant, {
    action: "transition",
    idempotencyKey: `stage28-cross-${runId}-0001`,
    incidentId: created.incidentId,
    expectedVersion: 1,
    nextStatus: "OPEN",
    reason: "Cross-tenant attempt rejected.",
  });
  assert.equal(crossTenant.status, 403);

  const timeline = await db.collection("securityIncidents").doc(created.incidentId).collection("timeline").get();
  const audits = await db.collection("securityAuditEvents").where("reference", "==", created.incidentId).get();
  assert.equal(timeline.size, 1);
  assert.equal(audits.size, 1);
});

test("incident lifecycle uses optimistic versions and containment revokes tenant sessions", async () => {
  const create = await post(authorized, {
    action: "create_draft",
    idempotencyKey: `stage28-life-${runId}-0001`,
    title: "Containment test",
    summary: "A non-sensitive incident fixture for containment.",
    severity: "high",
  });
  assert.equal(create.status, 201);
  const { incidentId } = await create.json() as { incidentId: string };

  const invalid = await post(authorized, {
    action: "transition",
    idempotencyKey: `stage28-invalid-${runId}-0001`,
    incidentId,
    expectedVersion: 1,
    nextStatus: "CLOSED",
    reason: "Invalid initial transition.",
  });
  assert.equal(invalid.status, 409);

  for (const [nextStatus, expectedVersion, idempotencyKey] of [
    ["OPEN", 1, `stage28-open-${runId}-0001`],
    ["TRIAGED", 2, `stage28-investigate-${runId}-0001`],
  ] as const) {
    const response = await post(authorized, {
      action: "transition",
      idempotencyKey,
      incidentId,
      expectedVersion,
      nextStatus,
      reason: "Reviewed evidence and advanced lifecycle.",
    });
    assert.equal(response.status, 200);
  }

  const contained = await post(authorized, {
    action: "contain_sessions",
    idempotencyKey: `stage28-contain-${runId}-0001`,
    incidentId,
    expectedVersion: 3,
    targetUid: target.uid,
    reason: "Containment is authorized for this test.",
  });
  assert.equal(contained.status, 200);
  const result = await contained.json() as { status: string };
  assert.equal(result.status, "CONTAINING");
  const sessionSnapshot = await db.collection("securitySessions").where("uid", "==", target.uid).limit(10).get();
  assert.ok(sessionSnapshot.docs.every((session) => session.get("status") === "revoked"));
  const incident = await db.collection("securityIncidents").doc(incidentId).get();
  assert.equal(incident.get("status"), "CONTAINING");
  assert.equal(incident.get("version"), 4);
});
