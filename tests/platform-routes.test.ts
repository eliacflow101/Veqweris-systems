import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { after, before, test } from "node:test";
import { subscriptionPlans } from "../lib/platform/engine";
import { makeEmployeeXlsx } from "./helpers/employee-xlsx-fixture";

const projectId = "demo-veqweris-platform-routes";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.FIREBASE_PROJECT_ID = projectId;
process.env.FIREBASE_CLIENT_EMAIL = "platform-route-tests@demo-veqweris-platform-routes.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";

let db: import("firebase-admin/firestore").Firestore;
let auth: import("firebase-admin/auth").Auth;
let sessionTokenHash: (token: string) => string;
let platformRoutes: typeof import("../app/api/platform/route");
let authTokens: Record<string, string>;
let supportUid = "";

async function createAuthenticatedUser(email: string, password: string) {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=platform-route-tests`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) },
  );
  const responseBody = await response.text();
  assert.equal(response.status, 200, `Auth emulator account creation failed: ${responseBody}`);
  const result = JSON.parse(responseBody) as { localId: string; idToken: string };
  await db.collection("securitySessions").doc(sessionTokenHash(result.idToken)).set({
    uid: result.localId,
    status: "active",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  return { uid: result.localId, token: result.idToken };
}

function platformRequest(url: string, token: string, body?: Record<string, unknown>) {
  return new Request(`http://localhost/api/platform${url}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

before(async () => {
  const admin = await import("../lib/firebase/admin");
  const serverAuth = await import("../lib/firebase/server-auth");
  platformRoutes = await import("../app/api/platform/route");
  assert.ok(admin.adminDb && admin.adminAuth, "Firebase Admin emulator configuration is required.");
  db = admin.adminDb;
  auth = admin.adminAuth;
  sessionTokenHash = serverAuth.sessionTokenHash;

  const tenant = await createAuthenticatedUser("tenant-owner@example.test", "Veqweris-Route-Test-1!");
  const operator = await createAuthenticatedUser("platform-owner@example.test", "Veqweris-Route-Test-2!");
  const support = await createAuthenticatedUser("platform-support@example.test", "Veqweris-Route-Test-3!");
  supportUid = support.uid;
  authTokens = { tenant: tenant.token, operator: operator.token, support: support.token };
  const tenantUsers = [
    { role: "Owner", account: tenant },
    { role: "Admin", account: await createAuthenticatedUser("tenant-admin@example.test", "Veqweris-Route-Test-4!") },
    { role: "Manager", account: await createAuthenticatedUser("tenant-manager@example.test", "Veqweris-Route-Test-5!") },
    { role: "Employee", account: await createAuthenticatedUser("tenant-employee@example.test", "Veqweris-Route-Test-6!") },
  ] as const;
  for (const { role, account } of tenantUsers) {
    authTokens[role.toLowerCase()] = account.token;
    await db.collection("users").doc(account.uid).set({
      uid: account.uid, institutionId: "route-institution-a", role, status: "active",
    });
  }
  const tenantB = await createAuthenticatedUser("tenant-b-owner@example.test", "Veqweris-Route-Test-7!");
  const tenantC = await createAuthenticatedUser("tenant-c-owner@example.test", "Veqweris-Route-Test-8!");
  authTokens.tenantB = tenantB.token;
  authTokens.tenantC = tenantC.token;
  await db.collection("users").doc(tenantB.uid).set({
    uid: tenantB.uid, institutionId: "route-institution-b", role: "Owner", status: "active",
  });
  await db.collection("users").doc(tenantC.uid).set({
    uid: tenantC.uid, institutionId: "route-institution-c", role: "Owner", status: "active",
  });
  await db.collection("platformOperators").doc(operator.uid).set({
    uid: operator.uid, email: "platform-owner@example.test", platformRole: "Platform Owner", status: "active",
  });
  await db.collection("platformOperators").doc(support.uid).set({
    uid: support.uid, email: "platform-support@example.test", platformRole: "Platform Support", status: "active",
  });
  for (const id of ["route-institution-a", "route-institution-b", "route-institution-c"]) {
    await db.collection("institutions").doc(id).set({
      institutionId: id, name: id, country: "Test", status: "active", planTier: "basic", relationship: "Customer",
      policies: { supportAccessEnabled: true },
    });
  }
});

after(async () => {
  const { getApps, deleteApp } = await import("firebase-admin/app");
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

test("institution Owner cannot enter the platform administration API", async () => {
  const response = await platformRoutes.GET(platformRequest("?limit=2", authTokens.tenant));
  assert.equal(response.status, 403);
});

test("institution Owner, Admin, Manager, and Employee roles never grant platform capabilities", async () => {
  for (const role of ["owner", "admin", "manager", "employee"]) {
    const listing = await platformRoutes.GET(platformRequest("?limit=2", authTokens[role]));
    assert.equal(listing.status, 403, `${role} cannot list platform institutions`);
    const mutation = await platformRoutes.POST(platformRequest("", authTokens[role], {
      action: "assign_plan", institutionId: "route-institution-a", planId: "enterprise",
    }));
    assert.equal(mutation.status, 403, `${role} cannot perform platform mutations`);
  }
});

test("platform institution listing enforces bounded cursor pagination", async () => {
  const firstResponse = await platformRoutes.GET(platformRequest("?limit=2", authTokens.operator));
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json() as { institutions: Array<{ institutionId: string }>; directory: { pageSize: number; nextCursor: string | null } };
  assert.equal(first.directory.pageSize, 2);
  assert.equal(first.institutions.length, 2);
  assert.ok(first.directory.nextCursor);

  const secondResponse = await platformRoutes.GET(platformRequest(`?limit=2&cursor=${encodeURIComponent(first.directory.nextCursor)}`, authTokens.operator));
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json() as { institutions: Array<{ institutionId: string }>; directory: { nextCursor: string | null } };
  assert.ok(second.institutions.length > 0 && second.institutions.length <= 2);
  assert.equal(second.directory.nextCursor, null);
  assert.ok(!first.institutions.some(({ institutionId }) => second.institutions.some((item) => item.institutionId === institutionId)));
});

test("plan assignment preserves relationship and persists durable audit", async () => {
  const response = await platformRoutes.POST(platformRequest("", authTokens.operator, {
    action: "assign_plan", institutionId: "route-institution-a", planId: "enterprise",
  }));
  if (response.status !== 200) assert.fail(await response.text());
  const institution = await db.collection("institutions").doc("route-institution-a").get();
  assert.equal(institution.get("planTier"), "enterprise");
  assert.equal(institution.get("relationship"), "Customer");
  const audit = await db.collection("platformAuditEvents").where("action", "==", "plan.assigned").limit(1).get();
  assert.equal(audit.size, 1);
});

test("plan assignment follows managed migration targets and rejects inactive catalog plans", async () => {
  const basicRef = db.collection("platformPlanCatalog").doc("basic");
  const enterpriseRef = db.collection("platformPlanCatalog").doc("enterprise");
  const originalBasic = await basicRef.get();
  const originalEnterprise = await enterpriseRef.get();
  const originalBasicData = originalBasic.data();
  const originalEnterpriseData = originalEnterprise.data();
  assert.ok(originalBasicData && originalEnterpriseData, "the managed plan catalog should be seeded");
  try {
    await basicRef.set({ ...originalBasicData, migrationTargets: ["professional"] });
    const prohibited = await platformRoutes.POST(platformRequest("", authTokens.operator, {
      action: "assign_plan", institutionId: "route-institution-b", planId: "enterprise",
    }));
    assert.equal(prohibited.status, 409);
    assert.equal((await db.collection("institutions").doc("route-institution-b").get()).get("planTier"), "basic");

    await basicRef.set({ ...originalBasicData, migrationTargets: ["enterprise"] });
    await enterpriseRef.set({ ...originalEnterpriseData, status: "deprecated" });
    const inactive = await platformRoutes.POST(platformRequest("", authTokens.operator, {
      action: "assign_plan", institutionId: "route-institution-b", planId: "enterprise",
    }));
    assert.equal(inactive.status, 400);
    assert.equal((await db.collection("institutions").doc("route-institution-b").get()).get("planTier"), "basic");
  } finally {
    await Promise.all([
      basicRef.set(originalBasicData),
      enterpriseRef.set(originalEnterpriseData),
    ]);
  }
});

test("relationship, billing and security controls require capabilities and persist audit evidence", async () => {
  const supportDenied = await platformRoutes.POST(platformRequest("", authTokens.support, {
    action: "assign_relationship", institutionId: "route-institution-a", relationship: "Educational Partner",
  }));
  assert.equal(supportDenied.status, 403);

  const relationship = await platformRoutes.POST(platformRequest("", authTokens.operator, {
    action: "assign_relationship", institutionId: "route-institution-a", relationship: "Educational Partner",
  }));
  assert.equal(relationship.status, 200, await relationship.text());
  let institution = await db.collection("institutions").doc("route-institution-a").get();
  assert.equal(institution.get("planTier"), "enterprise");
  assert.equal(institution.get("relationship"), "Educational Partner");

  const billing = await platformRoutes.POST(platformRequest("", authTokens.operator, {
    action: "update_billing", institutionId: "route-institution-a", billingEnabled: false, invoicesEnabled: false, note: "Approved billing pause",
  }));
  assert.equal(billing.status, 200, await billing.text());
  institution = await db.collection("institutions").doc("route-institution-a").get();
  assert.equal(institution.get("subscription.billingEnabled"), false);
  assert.equal(institution.get("subscription.invoicesEnabled"), false);

  const security = await platformRoutes.POST(platformRequest("", authTokens.operator, {
    action: "update_security", institutionId: "route-institution-a", level: "elevated", reason: "Route test review",
  }));
  assert.equal(security.status, 200, await security.text());
  institution = await db.collection("institutions").doc("route-institution-a").get();
  assert.equal(institution.get("securityState.level"), "elevated");

  for (const action of ["relationship.assigned", "billing.updated", "security_state.updated"]) {
    const audit = await db.collection("platformAuditEvents").where("action", "==", action).limit(1).get();
    assert.equal(audit.size, 1, `${action} has durable platform audit evidence`);
  }
});

test("plan catalog prevents deactivating an assigned plan and seeds defaults idempotently", async () => {
  const deactivation = await platformRoutes.POST(platformRequest("", authTokens.operator, {
    action: "update_plan_catalog",
    plan: { planId: "basic", name: "Basic", category: "commercial", description: "Default commercial plan assigned at registration. Core operations with invoiced billing.", billingEnabled: true, invoicesEnabled: true, premiumFeatures: false, moduleScope: "core", features: [], limits: { maxUsers: 25, maxDepartments: 8, maxStorageMb: 2048, maxMonthlyNotifications: 5000, maxIntegrationEndpoints: 2 }, migrationTargets: ["professional", "enterprise"], visibleToCustomers: true, status: "deprecated" },
  }));
  assert.equal(deactivation.status, 400);
  const activePlans = await db.collection("platformPlanCatalog").where("status", "==", "active").get();
  assert.equal(activePlans.size, 6);
  const events = await db.collection("platformAuditEvents").where("action", "==", "plan.catalog.updated").get();
  assert.equal(events.size, 0, "rejected configuration changes must not create success-shaped audit evidence");
});

test("authorized plan catalog edits persist and produce audit evidence", async () => {
  const catalog = await db.collection("platformPlanCatalog").doc("enterprise").get();
  const plan = catalog.data();
  assert.ok(plan);
  const response = await platformRoutes.POST(platformRequest("", authTokens.operator, {
    action: "update_plan_catalog",
    plan: {
      ...plan,
      description: "Enterprise plan managed by platform administration.",
      limits: { ...plan.limits, maxUsers: 321 },
    },
  }));
  assert.equal(response.status, 200, await response.text());
  assert.equal((await db.collection("platformPlanCatalog").doc("enterprise").get()).get("description"), "Enterprise plan managed by platform administration.");
  const effective = await platformRoutes.GET(platformRequest("?institutionId=route-institution-a", authTokens.operator));
  const effectiveData = await effective.json() as { view: { entitlement: { limits: { maxUsers: number } } } };
  assert.equal(effectiveData.view.entitlement.limits.maxUsers, 321, "catalog-edited limits become the effective tenant entitlement");
  const events = await db.collection("platformAuditEvents").where("action", "==", "plan.catalog.updated").get();
  assert.equal(events.size, 1);
});

test("Platform Support cannot inspect an institution without a matching active grant", async () => {
  const response = await platformRoutes.GET(platformRequest("?institutionId=route-institution-a", authTokens.support));
  assert.equal(response.status, 403);
});

test("support grants are scoped, auditable, expiring and revocable", async () => {
  const grantResponse = await platformRoutes.POST(platformRequest("", authTokens.operator, {
    action: "grant_support", institutionId: "route-institution-a", supportOperatorUid: supportUid, scopes: ["institution.overview"],
    reason: "Investigate tenant-reported access issue", durationMinutes: 60,
  }));
  assert.equal(grantResponse.status, 201);
  const { grant } = await grantResponse.json() as { grant: { grantId: string } };

  const allowed = await platformRoutes.GET(platformRequest("?institutionId=route-institution-a", authTokens.support));
  assert.equal(allowed.status, 200, await allowed.clone().text());
  const allowedBody = await allowed.json() as { view: Record<string, unknown> };
  for (const field of [
    "securityLevel", "securityState", "health", "billingEnabled", "billingState", "planId",
    "planName", "planCategory", "plan", "subscription", "entitlement", "modules", "policies",
  ]) {
    assert.equal(field in allowedBody.view, false, `overview-only server response must omit ${field}`);
  }
  const deniedCrossTenant = await platformRoutes.GET(platformRequest("?institutionId=route-institution-b", authTokens.support));
  assert.equal(deniedCrossTenant.status, 403);

  const revoke = await platformRoutes.POST(platformRequest("", authTokens.operator, {
    action: "revoke_support", grantId: grant.grantId, reason: "Investigation complete",
  }));
  assert.equal(revoke.status, 200);
  const revokedAccess = await platformRoutes.GET(platformRequest("?institutionId=route-institution-a", authTokens.support));
  assert.equal(revokedAccess.status, 403);

  const expiringResponse = await platformRoutes.POST(platformRequest("", authTokens.operator, {
    action: "grant_support", institutionId: "route-institution-a", supportOperatorUid: supportUid, scopes: ["institution.overview"],
    reason: "Verify grant expiration enforcement", durationMinutes: 60,
  }));
  assert.equal(expiringResponse.status, 201);
  const { grant: expiringGrant } = await expiringResponse.json() as { grant: { grantId: string } };
  await db.collection("platformSupportGrants").doc(expiringGrant.grantId).update({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
  const expiredAccess = await platformRoutes.GET(platformRequest("?institutionId=route-institution-a", authTokens.support));
  assert.equal(expiredAccess.status, 403);

  const securityEvent = await db.collection("securityEvents").doc(grant.grantId).get();
  assert.equal(securityEvent.exists, true);
  const platformAudit = await db.collection("platformAuditEvents").where("action", "in", ["support.granted", "support.revoked"]).get();
  assert.ok(platformAudit.size >= 3);
});

test("monitoring signal writes require management capability, bounded values, and atomic audit", async () => {
  const denied = await platformRoutes.POST(platformRequest("", authTokens.support, {
    action: "record_signal", institutionId: "route-institution-a", domain: "activity", metric: "events", value: 1,
  }));
  assert.equal(denied.status, 403);

  const invalidDomain = await platformRoutes.POST(platformRequest("", authTokens.operator, {
    action: "record_signal", institutionId: "route-institution-a", domain: "not-a-domain", metric: "events", value: 1,
  }));
  assert.equal(invalidDomain.status, 400);
  const unboundedValue = await platformRoutes.POST(platformRequest("", authTokens.operator, {
    action: "record_signal", institutionId: "route-institution-a", domain: "activity", metric: "events", value: 1e20,
  }));
  assert.equal(unboundedValue.status, 400);

  const recorded = await platformRoutes.POST(platformRequest("", authTokens.operator, {
    action: "record_signal", institutionId: "route-institution-a", domain: "activity", metric: "events", value: 3,
    unit: "count", note: "Validated operator observation",
  }));
  assert.equal(recorded.status, 201, await recorded.clone().text());
  const { signal } = await recorded.json() as { signal: { signalId: string } };
  assert.equal((await db.collection("platformMonitoringSignals").doc(signal.signalId).get()).exists, true);
  const auditRecord = await db.collection("platformAuditEvents")
    .where("resourceId", "==", signal.signalId).limit(1).get();
  assert.equal(auditRecord.size, 1, "signal and platform audit are written as one transaction");
});

test("suspended institution is denied at governance and healthcare Admin SDK routes", async () => {
  const { GET: governanceGet } = await import("../app/api/governance/route");
  const { POST: createBill } = await import("../app/api/healthcare/billing/route");
  const suspension = await platformRoutes.POST(platformRequest("", authTokens.operator, {
    action: "update_status", institutionId: "route-institution-a", status: "suspended",
  }));
  assert.equal(suspension.status, 200, await suspension.clone().text());
  try {
    const headers = { authorization: `Bearer ${authTokens.tenant}` };
    const governance = await governanceGet(new Request("http://localhost/api/governance", { headers }));
    const bill = await createBill(new Request("http://localhost/api/healthcare/billing", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ patientId: "patient-1", description: "Consultation", total: 10, currency: "USD" }),
    }));
    assert.equal(governance.status, 403);
    assert.equal(bill.status, 403);
  } finally {
    const reactivation = await platformRoutes.POST(platformRequest("", authTokens.operator, {
      action: "update_status", institutionId: "route-institution-a", status: "active",
    }));
    assert.equal(reactivation.status, 200, await reactivation.clone().text());
  }
  const suspensionAudit = await db.collection("platformAuditEvents").where("action", "==", "institution.suspended").limit(1).get();
  const reactivationAudit = await db.collection("platformAuditEvents").where("action", "==", "institution.reactivated").limit(1).get();
  assert.equal(suspensionAudit.size, 1);
  assert.equal(reactivationAudit.size, 1);
});

test("department API enforces the plan limit under concurrent requests", async () => {
  const basic = subscriptionPlans.find((plan) => plan.planId === "basic");
  assert.ok(basic);
  await db.collection("platformPlanCatalog").doc("basic").set({
    ...basic,
    limits: { ...basic.limits, maxDepartments: 1 },
  });
  const { POST } = await import("../app/api/departments/route");
  const create = (name: string) => POST(new Request("http://localhost/api/departments", {
    method: "POST",
    headers: { authorization: ["Bearer", authTokens.tenantB].join(" "), "content-type": "application/json" },
    body: JSON.stringify({ name, departmentCode: name.toUpperCase() }),
  }));
  const responses = await Promise.all([create("Only Department"), create("Over Limit Department")]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const departments = await db.collection("departments").where("institutionId", "==", "route-institution-b").get();
  assert.equal(departments.size, 1);
});

test("integration API enforces feature entitlement and endpoint plan limits", async () => {
  const basic = subscriptionPlans.find((plan) => plan.planId === "basic");
  const professional = subscriptionPlans.find((plan) => plan.planId === "professional");
  assert.ok(basic && professional);
  await db.collection("platformPlanCatalog").doc("basic").set(basic);
  await db.collection("institutions").doc("route-institution-b").update({ planTier: "basic" });
  const { POST } = await import("../app/api/integrations/route");
  const denied = await POST(new Request("http://localhost/api/integrations", {
    method: "POST",
    headers: { authorization: ["Bearer", authTokens.tenantB].join(" "), "content-type": "application/json" },
    body: JSON.stringify({ provider: "test", name: "Denied integration", scopes: ["hospitality:bookings"] }),
  }));
  assert.equal(denied.status, 403, "Basic does not receive the external integrations feature");

  await db.collection("platformPlanCatalog").doc("professional").set({
    ...professional,
    limits: { ...professional.limits, maxIntegrationEndpoints: 1 },
  });
  await db.collection("institutions").doc("route-institution-c").update({ planTier: "professional" });
  const create = (name: string) => POST(new Request("http://localhost/api/integrations", {
    method: "POST",
    headers: { authorization: ["Bearer", authTokens.tenantC].join(" "), "content-type": "application/json" },
    body: JSON.stringify({ provider: "test", name, scopes: ["hospitality:bookings"] }),
  }));
  const responses = await Promise.all([create("Allowed integration"), create("Over limit integration")]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const integrations = await db.collection("integrations").where("institutionId", "==", "route-institution-c").get();
  assert.equal(integrations.size, 1);
});

test("payment routes enforce tenant scope and finalize only provider-verified payments", async () => {
  const professional = subscriptionPlans.find((plan) => plan.planId === "professional");
  assert.ok(professional);
  await db.collection("platformPlanCatalog").doc("professional").set(professional);
  await db.collection("institutions").doc("route-institution-a").update({
    planTier: "professional",
    status: "active",
    "subscription.billingEnabled": true,
    "subscription.invoicesEnabled": true,
  });
  await db.collection("institutions").doc("route-institution-b").update({ planTier: "professional", status: "active" });
  process.env.FLUTTERWAVE_SECRET_KEY = "emulator-test-secret";
  const webhookSecret = "emulator-test-webhook-hash";
  process.env.FLUTTERWAVE_SECRET_HASH = webhookSecret;

  const originalFetch = globalThis.fetch;
  let internalReference = "";
  let checkoutInitializationCalls = 0;
  let failCheckoutInitialization = false;
  let recoveryProviderState: "pending" | "completed" = "pending";
  let timeoutProviderSubmitted = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/payments")) {
      checkoutInitializationCalls += 1;
      if (failCheckoutInitialization) throw new Error("simulated ambiguous checkout outcome");
      const requestBody = JSON.parse(String(init?.body)) as { tx_ref: string };
      internalReference = requestBody.tx_ref;
      return new Response(JSON.stringify({ status: "success", data: { link: "https://checkout.invalid/test" } }), { status: 200 });
    }
    if (url.endsWith("/transactions/provider-transaction-1/verify")) {
      return new Response(JSON.stringify({
        status: "success",
        data: {
          id: "provider-transaction-1", tx_ref: internalReference, status: "successful",
          amount: 50, currency: "USD", payment_type: "card",
        },
      }), { status: 200 });
    }
    if (url.endsWith("/transactions/provider-transaction-1/refunds")) {
      return new Response(JSON.stringify({ status: "success", data: [] }), { status: 200 });
    }
    if (url.endsWith("/transactions/provider-transaction-1/refund")) {
      return new Response(JSON.stringify({ status: "success", data: { id: "route-refund-confirmed", status: "success" } }), { status: 200 });
    }
    if (url.endsWith("/transactions/provider-refund-recovery/refunds")) {
      const refunds = recoveryProviderState === "pending"
        ? []
        : [{ id: "route-refund-pending", status: "completed", amount: 20 }];
      return new Response(JSON.stringify({ status: "success", data: refunds }), { status: 200 });
    }
    if (url.endsWith("/transactions/provider-refund-recovery/refund")) {
      return new Response(JSON.stringify({ status: "success", data: { id: "route-refund-pending", status: "pending" } }), { status: 200 });
    }
    if (url.endsWith("/transactions/provider-refund-timeout/refunds")) {
      const refunds = timeoutProviderSubmitted
        ? [{ id: "route-refund-timeout", status: "completed", amount: 15 }]
        : [];
      return new Response(JSON.stringify({ status: "success", data: refunds }), { status: 200 });
    }
    if (url.endsWith("/transactions/provider-refund-timeout/refund")) {
      timeoutProviderSubmitted = true;
      throw new Error("simulated connection loss after provider submission");
    }
    throw new Error(`Unexpected provider request: ${url}`);
  };
  try {
    const billRef = db.collection("bills").doc("route-payment-bill");
    await billRef.set({
      billId: billRef.id, institutionId: "route-institution-a", total: 50, currency: "USD", status: "OPEN",
    });
    const { POST: createIntent } = await import("../app/api/payments/intent/route");
    const intentRequest = (token: string, billId: string) => new Request("http://localhost/api/payments/intent", {
      method: "POST",
      headers: { authorization: ["Bearer", token].join(" "), "content-type": "application/json" },
      body: JSON.stringify({
        billId, idempotencyKey: `route-test-${billId}`, customerEmail: "payer@example.test",
        redirectUrl: "https://app.invalid/payment-return",
      }),
    });
    const concurrentBill = db.collection("bills").doc("route-concurrent-payment-bill");
    await concurrentBill.set({
      billId: concurrentBill.id, institutionId: "route-institution-a", total: 25, currency: "USD", status: "OPEN",
    });
    const beforeConcurrentCalls = checkoutInitializationCalls;
    const concurrentIntents = await Promise.all([
      createIntent(new Request("http://localhost/api/payments/intent", {
        method: "POST",
        headers: { authorization: `Bearer ${authTokens.owner}`, "content-type": "application/json" },
        body: JSON.stringify({
          billId: concurrentBill.id, idempotencyKey: "concurrent-payment-key-a", customerEmail: "payer@example.test",
          redirectUrl: "https://app.invalid/payment-return",
        }),
      })),
      createIntent(new Request("http://localhost/api/payments/intent", {
        method: "POST",
        headers: { authorization: `Bearer ${authTokens.owner}`, "content-type": "application/json" },
        body: JSON.stringify({
          billId: concurrentBill.id, idempotencyKey: "concurrent-payment-key-b", customerEmail: "payer@example.test",
          redirectUrl: "https://app.invalid/payment-return",
        }),
      })),
    ]);
    assert.deepEqual(concurrentIntents.map((response) => response.status).sort(), [200, 409]);
    assert.equal(checkoutInitializationCalls - beforeConcurrentCalls, 1);
    assert.equal((await db.collection("payments").where("billId", "==", concurrentBill.id).get()).size, 1);

    const unresolvedBill = db.collection("bills").doc("route-unresolved-payment-bill");
    await unresolvedBill.set({
      billId: unresolvedBill.id, institutionId: "route-institution-a", total: 12, currency: "USD", status: "OPEN",
    });
    failCheckoutInitialization = true;
    const beforeUnresolvedCall = checkoutInitializationCalls;
    const ambiguousIntent = await createIntent(intentRequest(authTokens.owner, unresolvedBill.id));
    assert.equal(ambiguousIntent.status, 502);
    failCheckoutInitialization = false;
    const unresolvedRetry = await createIntent(intentRequest(authTokens.owner, unresolvedBill.id));
    assert.equal(unresolvedRetry.status, 409, "ambiguous provider outcomes must not return a success-shaped retry response");
    assert.equal(checkoutInitializationCalls - beforeUnresolvedCall, 1);

    const unauthenticated = await createIntent(new Request("http://localhost/api/payments/intent", {
      method: "POST", headers: { authorization: "Bearer invalid", "content-type": "application/json" }, body: "{}",
    }));
    assert.equal(unauthenticated.status, 401);
    await db.collection("institutions").doc("route-institution-a").update({ status: "suspended" });
    const suspended = await createIntent(intentRequest(authTokens.owner, "suspended-bill"));
    assert.equal(suspended.status, 403, "suspended institutions cannot initialize new payment operations");
    await db.collection("institutions").doc("route-institution-a").update({ status: "active" });

    const intent = await createIntent(intentRequest(authTokens.owner, billRef.id));
    assert.equal(intent.status, 200, await intent.clone().text());
    const intentBody = await intent.json() as { paymentId: string; internalReference: string; checkoutLink: string };
    internalReference = intentBody.internalReference;
    const repeatedIntent = await createIntent(intentRequest(authTokens.owner, billRef.id));
    assert.equal(repeatedIntent.status, 200);
    assert.equal((await repeatedIntent.json() as { checkoutLink: string }).checkoutLink, intentBody.checkoutLink);
    const intentPaymentRef = db.collection("payments").doc(intentBody.paymentId);
    await intentPaymentRef.update({ checkoutLink: null });
    const missingCheckoutLink = await createIntent(intentRequest(authTokens.owner, billRef.id));
    assert.equal(missingCheckoutLink.status, 409, "PENDING retries require a stored checkout link");
    await intentPaymentRef.update({ checkoutLink: intentBody.checkoutLink });

    const crossTenant = await createIntent(intentRequest(authTokens.tenantB, billRef.id));
    assert.equal(crossTenant.status, 404, "another institution cannot initialize a payment for this bill");

    const { POST: paymentWebhook } = await import("../app/api/payments/webhook/route");
    const webhookBody = JSON.stringify({
      event: "charge.completed",
      data: { id: "provider-transaction-1", tx_ref: internalReference, status: "successful" },
    });
    const { createFlutterwaveSignature } = await import("../lib/payments/flutterwave");
    const invalid = await paymentWebhook(new Request("http://localhost/api/payments/webhook", {
      method: "POST", headers: { "verif-hash": "invalid" }, body: webhookBody,
    }));
    assert.equal(invalid.status, 401, "invalid provider signatures are rejected");

    const verified = await paymentWebhook(new Request("http://localhost/api/payments/webhook", {
      method: "POST",
      headers: { "verif-hash": createFlutterwaveSignature(webhookBody, webhookSecret) },
      body: webhookBody,
    }));
    assert.equal(verified.status, 200, await verified.text());
    assert.equal((await db.collection("payments").doc(intentBody.paymentId).get()).get("status"), "FINALIZED");
    assert.equal((await billRef.get()).get("status"), "PAID");
    const receipts = await db.collection("receipts").where("paymentId", "==", intentBody.paymentId).get();
    assert.equal(receipts.size, 1);

    const { POST: refund } = await import("../app/api/payments/refund/route");
    const refundRequest = (token: string, payload: Record<string, unknown>) => new Request("http://localhost/api/payments/refund", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const crossTenantRefund = await refund(refundRequest(authTokens.tenantB, {
      paymentId: intentBody.paymentId, amount: 50, idempotencyKey: "cross-tenant-refund",
    }));
    assert.equal(crossTenantRefund.status, 404);
    const refundPayload = { paymentId: intentBody.paymentId, amount: 50, idempotencyKey: "route-refund-confirmed-1" };
    const firstRefund = await refund(refundRequest(authTokens.owner, refundPayload));
    assert.equal(firstRefund.status, 200, await firstRefund.clone().text());
    assert.equal((await db.collection("payments").doc(intentBody.paymentId).get()).get("status"), "REFUNDED");
    const repeatedRefund = await refund(refundRequest(authTokens.owner, refundPayload));
    assert.equal(repeatedRefund.status, 200);
    assert.equal((await repeatedRefund.json() as { duplicate: boolean }).duplicate, true);

    const pendingPaymentId = "route-refund-recovery-payment";
    await db.collection("payments").doc(pendingPaymentId).set({
      paymentId: pendingPaymentId, institutionId: "route-institution-a", billId: "route-payment-bill",
      transactionAmount: 20, transactionCurrency: "USD", providerReference: "provider-refund-recovery",
      status: "FINALIZED",
    });
    const pendingRefund = await refund(refundRequest(authTokens.owner, {
      paymentId: pendingPaymentId, amount: 20, idempotencyKey: "route-refund-recovery-1",
    }));
    assert.equal(pendingRefund.status, 202);
    const pendingBody = await pendingRefund.json() as { refundId: string; status: string };
    assert.equal(pendingBody.status, "AMBIGUOUS");
    recoveryProviderState = "completed";
    const recoveredRefund = await refund(refundRequest(authTokens.owner, {
      action: "reconcile", refundId: pendingBody.refundId,
    }));
    assert.equal(recoveredRefund.status, 200, await recoveredRefund.clone().text());
    assert.equal((await db.collection("payments").doc(pendingPaymentId).get()).get("status"), "REFUNDED");

    const timeoutPaymentId = "route-refund-timeout-payment";
    await db.collection("payments").doc(timeoutPaymentId).set({
      paymentId: timeoutPaymentId, institutionId: "route-institution-a", billId: "route-payment-bill",
      transactionAmount: 15, transactionCurrency: "USD", providerReference: "provider-refund-timeout",
      status: "FINALIZED",
    });
    const timeoutRefund = await refund(refundRequest(authTokens.owner, {
      paymentId: timeoutPaymentId, amount: 15, idempotencyKey: "route-refund-timeout-1",
    }));
    assert.equal(timeoutRefund.status, 202);
    const timeoutBody = await timeoutRefund.json() as { refundId: string; status: string };
    assert.equal(timeoutBody.status, "AMBIGUOUS");
    const recoveredTimeout = await refund(refundRequest(authTokens.owner, {
      action: "reconcile", refundId: timeoutBody.refundId,
    }));
    assert.equal(recoveredTimeout.status, 200, await recoveredTimeout.clone().text());
    assert.equal((await db.collection("payments").doc(timeoutPaymentId).get()).get("status"), "REFUNDED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("network contract approvals serialize with institution-scoped audit chains", async () => {
  const { POST: networkPost } = await import("../app/api/network/route");
  await db.collection("networkProfiles").doc("route-institution-b").set({
    institutionId: "route-institution-b",
    institutionName: "Route Institution B",
    broadLocation: "North",
    selectedServices: ["coordination"],
    participation: "open",
    contactEnabled: true,
    trustState: "Registered",
    platformTrustState: "Registered",
    updatedAt: new Date().toISOString(),
  });
  const create = await networkPost(new Request("http://localhost/api/network", {
    method: "POST",
    headers: { authorization: `Bearer ${authTokens.owner}`, "content-type": "application/json" },
    body: JSON.stringify({
      action: "create_contract",
      contract: {
        institutionAId: "route-institution-a",
        institutionBId: "route-institution-b",
        scopes: ["workspace_records"],
        records: ["service-summary"],
        users: [],
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    }),
  }));
  assert.equal(create.status, 201, await create.clone().text());
  const { contract } = await create.json() as { contract: { contractId: string } };
  const approve = (token: string) => networkPost(new Request("http://localhost/api/network", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "approve_contract", contractId: contract.contractId }),
  }));
  const approvals = await Promise.all([approve(authTokens.owner), approve(authTokens.tenantB)]);
  assert.ok(approvals.every((response) => response.status === 200), JSON.stringify(await Promise.all(approvals.map((response) => response.clone().text()))));
  const stored = await db.collection("collaborationContracts").doc(contract.contractId).get();
  assert.equal(stored.get("status"), "active");
  assert.ok(stored.get("approvedBy.route-institution-a"));
  assert.ok(stored.get("approvedBy.route-institution-b"));
  const recordPayload = {
    action: "create_workspace_record",
    contractId: contract.contractId,
    record: {
      recordId: "network-summary-route-test",
      recordType: "service-summary",
      scope: "workspace_records",
      title: "Service summary",
      body: "Approved, bounded summary.",
      ownerInstitutionId: "route-institution-b",
      createdBy: "forged",
      unexpected: "must not persist",
    },
  };
  const workspaceRecord = await networkPost(new Request("http://localhost/api/network", {
    method: "POST",
    headers: { authorization: `Bearer ${authTokens.owner}`, "content-type": "application/json" },
    body: JSON.stringify(recordPayload),
  }));
  assert.equal(workspaceRecord.status, 201, await workspaceRecord.clone().text());
  const storedRecord = await db.collection("networkWorkspaceRecords").doc("network-summary-route-test").get();
  assert.equal(storedRecord.get("ownerInstitutionId"), "route-institution-a");
  assert.equal(storedRecord.get("createdBy"), (await auth.verifyIdToken(authTokens.owner)).uid);
  assert.equal(storedRecord.get("unexpected"), undefined);
  const conflictingRecord = await networkPost(new Request("http://localhost/api/network", {
    method: "POST",
    headers: { authorization: `Bearer ${authTokens.tenantB}`, "content-type": "application/json" },
    body: JSON.stringify(recordPayload),
  }));
  assert.equal(conflictingRecord.status, 400);
  assert.equal((await db.collection("networkWorkspaceRecords").doc("network-summary-route-test").get()).get("ownerInstitutionId"), "route-institution-a");

  const approveAgain = await approve(authTokens.owner);
  assert.equal(approveAgain.status, 200);
  const revoke = () => networkPost(new Request("http://localhost/api/network", {
    method: "POST",
    headers: { authorization: `Bearer ${authTokens.owner}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "revoke_contract", contractId: contract.contractId }),
  }));
  assert.equal((await revoke()).status, 200);
  assert.equal((await revoke()).status, 200);
  assert.equal((await db.collection("collaborationContracts").doc(contract.contractId).get()).get("status"), "revoked");
  const unrelatedRevoke = await networkPost(new Request("http://localhost/api/network", {
    method: "POST",
    headers: { authorization: `Bearer ${authTokens.tenantC}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "revoke_contract", contractId: contract.contractId }),
  }));
  assert.equal(unrelatedRevoke.status, 400, "non-participants cannot read contracts through idempotent revocation");

  const { verifyAuditChain } = await import("../lib/governance");
  const chainSnapshot = await db.collection("auditEvents").where("institutionId", "==", "route-institution-a").get();
  const events = chainSnapshot.docs.map((document) => document.data())
    .filter((event) => event.payload?.auditChain === "network")
    .sort((left, right) => left.sequence - right.sequence) as import("../lib/governance").AuditEvent[];
  assert.ok(events.length >= 2);
  assert.equal(verifyAuditChain(events), true);
});

test("network assistance transitions and profile writes are tenant-scoped and audited atomically", async () => {
  const { POST: networkPost } = await import("../app/api/network/route");
  const post = (token: string, body: Record<string, unknown>) => networkPost(new Request("http://localhost/api/network", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  await db.collection("networkProfiles").doc("route-institution-b").set({
    institutionId: "route-institution-b",
    institutionName: "Route Institution B",
    broadLocation: "North",
    selectedServices: ["coordination"],
    participation: "invite_only",
    contactEnabled: true,
    trustState: "Registered",
    platformTrustState: "Registered",
    updatedAt: new Date().toISOString(),
  });
  const deniedInvite = await post(authTokens.owner, {
    action: "request_assistance",
    request: {
      requestedInstitutionId: "route-institution-b",
      subject: "Coordination",
      description: "Request coordination support.",
      requestedScope: "assistance",
    },
  });
  assert.equal(deniedInvite.status, 400, "invite-only targets require an active membership");

  await db.collection("networkProfiles").doc("route-institution-b").update({ participation: "open" });
  const profileBody = {
    action: "upsert_profile",
    networkProfile: {
      institutionId: "route-institution-a",
      institutionName: "Route Institution A",
      broadLocation: "West",
      selectedServices: ["coordination"],
      participation: "open",
      contactEnabled: true,
      trustState: "Revoked",
      platformTrustState: "Revoked",
      updatedAt: new Date().toISOString(),
    },
  };
  const spoofedProfile = await post(authTokens.owner, {
    ...profileBody,
    networkProfile: { ...profileBody.networkProfile, institutionId: "route-institution-b" },
  });
  assert.equal(spoofedProfile.status, 400, "tenant profile cannot supply another institution identity");
  const preexistingPlatformTrust = (await db.collection("networkProfiles").doc("route-institution-a").get()).get("platformTrustState") ?? "Registered";
  const profileResponse = await post(authTokens.owner, profileBody);
  assert.equal(profileResponse.status, 200, await profileResponse.clone().text());
  const storedProfile = await db.collection("networkProfiles").doc("route-institution-a").get();
  assert.equal(storedProfile.get("trustState"), preexistingPlatformTrust, "tenant profile cannot override platform trust state");
  assert.equal(storedProfile.get("institutionId"), "route-institution-a", "tenant profile cannot redirect its institution record");

  const beforeProfile = storedProfile.data();
  const headRef = db.collection("networkAuditHeads").doc("route-institution-a");
  const beforeHead = (await headRef.get()).data();
  const originalRunTransaction = db.runTransaction.bind(db);
  const originalDescriptor = Object.getOwnPropertyDescriptor(db, "runTransaction");
  Object.defineProperty(db, "runTransaction", {
    configurable: true,
    value: (updateFunction: (transaction: import("firebase-admin/firestore").Transaction) => Promise<unknown>) =>
      originalRunTransaction((transaction) => updateFunction(new Proxy(transaction, {
        get(target, property) {
          const member = Reflect.get(target, property, target);
          if (property === "create") {
            return (...args: unknown[]) => {
              const reference = args[0] as { path?: string };
              if (reference.path?.startsWith("auditEvents/")) throw new Error("simulated network audit outage");
              return Reflect.apply(member, target, args);
            };
          }
          return typeof member === "function" ? member.bind(target) : member;
        },
      }) as import("firebase-admin/firestore").Transaction)),
  });
  try {
    const failedProfileUpdate = await post(authTokens.owner, {
      ...profileBody,
      networkProfile: { ...profileBody.networkProfile, institutionName: "Must not persist" },
    });
    assert.equal(failedProfileUpdate.status, 400);
    assert.equal((await db.collection("networkProfiles").doc("route-institution-a").get()).get("institutionName"), beforeProfile?.institutionName);
    assert.deepEqual((await headRef.get()).data(), beforeHead);
  } finally {
    if (originalDescriptor) Object.defineProperty(db, "runTransaction", originalDescriptor);
    else delete (db as unknown as { runTransaction?: unknown }).runTransaction;
  }

  const requestResponse = await post(authTokens.owner, {
    action: "request_assistance",
    request: {
      requestedInstitutionId: "route-institution-b",
      subject: "Coordination",
      description: "Request coordination support.",
      requestedScope: "assistance",
    },
  });
  assert.equal(requestResponse.status, 201, await requestResponse.clone().text());
  const { assistance } = await requestResponse.json() as { assistance: { requestId: string; state: string } };
  assert.equal(assistance.state, "Submitted");
  const underReview = await post(authTokens.tenantB, {
    action: "transition_assistance", requestId: assistance.requestId, nextState: "Under Review",
  });
  assert.equal(underReview.status, 200);
  const competingTransitions = await Promise.all([
    post(authTokens.tenantB, { action: "transition_assistance", requestId: assistance.requestId, nextState: "Accepted" }),
    post(authTokens.tenantB, { action: "transition_assistance", requestId: assistance.requestId, nextState: "Clarification Required" }),
  ]);
  assert.deepEqual(competingTransitions.map((response) => response.status).sort(), [200, 403]);
  const finalAssistance = await db.collection("assistanceRequests").doc(assistance.requestId).get();
  assert.ok(["Accepted", "Clarification Required"].includes(String(finalAssistance.get("state"))));

  const { verifyAuditChain } = await import("../lib/governance");
  const eventsSnapshot = await db.collection("auditEvents").where("institutionId", "==", "route-institution-a").get();
  const networkEvents = eventsSnapshot.docs.map((document) => document.data())
    .filter((event) => event.payload?.auditChain === "network")
    .sort((left, right) => left.sequence - right.sequence) as import("../lib/governance").AuditEvent[];
  assert.equal(verifyAuditChain(networkEvents), true);
});

test("platform bootstrap and session probes do not elevate institution users", async () => {
  const { GET: platformSession } = await import("../app/api/platform/session/route");
  const tenantSession = await platformSession(new Request("http://localhost/api/platform/session", {
    headers: { authorization: `Bearer ${authTokens.owner}` },
  }));
  assert.equal(tenantSession.status, 200);
  assert.equal((await tenantSession.json() as { operator: unknown }).operator, null);
  const operatorSession = await platformSession(new Request("http://localhost/api/platform/session", {
    headers: { authorization: `Bearer ${authTokens.operator}` },
  }));
  assert.equal((await operatorSession.json() as { operator: { platformRole: string } }).operator.platformRole, "Platform Owner");

  const { GET: bootstrapGet, POST: bootstrapPost } = await import("../app/api/platform/bootstrap/route");
  const bootstrapRequest = () => new Request("http://localhost/api/platform/bootstrap", {
    method: "POST",
    headers: { authorization: `Bearer ${authTokens.owner}` },
  });
  const eligibility = await bootstrapGet(bootstrapRequest());
  assert.equal(eligibility.status, 200);
  assert.equal((await eligibility.json() as { bootstrap: { allowed: boolean } }).bootstrap.allowed, false);
  const denied = await bootstrapPost(bootstrapRequest());
  assert.equal(denied.status, 403);
  const tenantOwner = await auth.getUserByEmail("tenant-owner@example.test");
  assert.equal((await db.collection("platformOperators").doc(tenantOwner.uid).get()).exists, false);
});

test("subscription and setup routes enforce active tenant scope and bounded setup reads", async () => {
  const { GET: subscriptionGet } = await import("../app/api/subscription/route");
  const subscriptionRequest = (token: string) => new Request("http://localhost/api/subscription", {
    headers: { authorization: `Bearer ${token}` },
  });
  const subscription = await subscriptionGet(subscriptionRequest(authTokens.owner));
  assert.equal(subscription.status, 200, await subscription.clone().text());
  const subscriptionBody = await subscription.json() as { institutionId: string; plans: Array<{ planId: string }> };
  assert.equal(subscriptionBody.institutionId, "route-institution-a");
  assert.ok(!subscriptionBody.plans.some((plan) => ["internal", "partner"].includes(plan.planId)));
  const crossTenantSubscription = await subscriptionGet(subscriptionRequest(authTokens.tenantB));
  assert.equal((await crossTenantSubscription.json() as { institutionId: string }).institutionId, "route-institution-b");

  const { GET: setupGet } = await import("../app/api/setup/route");
  const setupRequest = (token: string) => new Request("http://localhost/api/setup", {
    headers: { authorization: `Bearer ${token}` },
  });
  const setup = await setupGet(setupRequest(authTokens.owner));
  assert.equal(setup.status, 200, await setup.clone().text());
  const employeeSetup = await setupGet(setupRequest(authTokens.employee));
  assert.equal(employeeSetup.status, 403);
  await db.collection("institutions").doc("route-institution-a").update({ status: "suspended" });
  try {
    assert.equal((await setupGet(setupRequest(authTokens.owner))).status, 403);
    assert.equal((await subscriptionGet(subscriptionRequest(authTokens.owner))).status, 403);
  } finally {
    await db.collection("institutions").doc("route-institution-a").update({ status: "active" });
  }
});

test("platform monitoring aggregates storage and reports incomplete measurements as unavailable", async () => {
  const { GET } = platformRoutes;
  const firstRef = db.collection("documents").doc("route-monitoring-storage-sized");
  const missingSizeRef = db.collection("documents").doc("route-monitoring-storage-unsized");
  await firstRef.set({ institutionId: "route-institution-a", size: 1536 });
  const request = () => platformRequest("?institutionId=route-institution-a", authTokens.operator);
  try {
    const measuredResponse = await GET(request());
    assert.equal(measuredResponse.status, 200);
    const measured = await measuredResponse.json() as {
      view: {
        usage: { storageBytes: number | null };
        monitoring: { observations: Array<{ domain: string; availability: string; value: number | null; source: string }> };
      };
    };
    assert.equal(measured.view.usage.storageBytes, 1536);
    assert.deepEqual(measured.view.monitoring.observations.find((item) => item.domain === "storage"), {
      domain: "storage", availability: "available", value: 1536, unit: "bytes",
      source: "firestore-aggregate", reason: "Sum of tenant document sizes.", evidence: ["documents.size", "documents.blobPath"],
    });

    await missingSizeRef.set({ institutionId: "route-institution-a" });
    const unavailableResponse = await GET(request());
    assert.equal(unavailableResponse.status, 200);
    const unavailable = await unavailableResponse.json() as typeof measured;
    assert.equal(unavailable.view.usage.storageBytes, null);
    assert.deepEqual(unavailable.view.monitoring.observations.find((item) => item.domain === "storage"), {
      domain: "storage", availability: "unavailable", value: null, unit: null,
      source: "unavailable",
      reason: "Required usage aggregate unavailable: documents.size.",
      evidence: [],
    });
  } finally {
    await firstRef.delete();
    await missingSizeRef.delete();
  }
});

test("employee import is idempotent, capacity-limited, and recovers failed Auth cleanup", async () => {
  const { POST: confirmImport } = await import("../app/api/employees/import/confirm/route");
  const importRequest = (token: string | undefined, batchId: string) => confirmImport(new Request("http://localhost/api/employees/import/confirm", {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: JSON.stringify({ batchId }),
  }));
  const createBatch = async (batchId: string, institutionId: string, email: string, count = 1) => {
    await db.collection("bulkImportBatches").doc(batchId).set({
      batchId,
      institutionId,
      status: "pending_review",
      rows: Array.from({ length: count }, (_, index) => ({
        rowId: `row-${index + 1}`, allowed: true,
        officialEmail: index === 0 ? email : email.replace("@", `-${index + 1}@`),
        fullName: `Imported Employee ${index + 1}`, role: "Employee", department: null,
        position: "Staff", employmentType: "full_time",
      })),
    });
  };

  const successfulBatchId = "route-import-idempotent";
  await createBatch(successfulBatchId, "route-institution-a", "imported-route@example.test");
  assert.equal((await importRequest(undefined, successfulBatchId)).status, 401);
  assert.equal((await importRequest(authTokens.manager, successfulBatchId)).status, 403);
  const firstImport = await importRequest(authTokens.owner, successfulBatchId);
  assert.equal(firstImport.status, 200, await firstImport.clone().text());
  const firstBody = await firstImport.json() as { status: string; createdCount: number; results: Array<{ uid: string }> };
  assert.equal(firstBody.status, "completed");
  assert.equal(firstBody.createdCount, 1);
  const importedUid = firstBody.results[0].uid;
  assert.ok(importedUid);
  const importedProfile = await db.collection("users").doc(importedUid).get();
  assert.equal(importedProfile.get("institutionId"), "route-institution-a");
  assert.equal(importedProfile.get("status"), "active");
  assert.equal((await auth.getUser(importedUid)).email, "imported-route@example.test");
  const repeatedImport = await importRequest(authTokens.owner, successfulBatchId);
  assert.equal((await repeatedImport.json() as { createdCount: number }).createdCount, 1);
  assert.equal((await db.collection("users").where("institutionId", "==", "route-institution-a").where("email", "==", "imported-route@example.test").get()).size, 1);
  const crossTenantBatch = await importRequest(authTokens.tenantB, successfulBatchId);
  assert.equal(crossTenantBatch.status, 404);

  const basic = subscriptionPlans.find((plan) => plan.planId === "basic");
  assert.ok(basic);
  await db.collection("platformPlanCatalog").doc("basic").set({
    ...basic, limits: { ...basic.limits, maxUsers: 1 },
  });
  await db.collection("institutions").doc("route-institution-b").update({ planTier: "basic" });
  const limitedBatchId = "route-import-at-limit";
  await createBatch(limitedBatchId, "route-institution-b", "import-limit@example.test", 2);
  const limited = await importRequest(authTokens.tenantB, limitedBatchId);
  assert.equal(limited.status, 200);
  const limitedResult = await limited.json() as { failedCount: number; results: Array<{ status: string }> };
  assert.equal(limitedResult.failedCount, 2);
  assert.deepEqual(limitedResult.results.map((result) => result.status), ["failed", "failed"]);
  await assert.rejects(auth.getUserByEmail("import-limit@example.test"), (error: { code?: string }) => error.code === "auth/user-not-found");
  await assert.rejects(auth.getUserByEmail("import-limit-2@example.test"), (error: { code?: string }) => error.code === "auth/user-not-found");

  const recoverableBatchId = "route-import-cleanup-recovery";
  await createBatch(recoverableBatchId, "route-institution-b", "import-recover@example.test");
  const deleteUser = auth.deleteUser.bind(auth);
  auth.deleteUser = async () => { throw new Error("simulated Authentication cleanup outage"); };
  try {
    const recoverable = await importRequest(authTokens.tenantB, recoverableBatchId);
    const result = await recoverable.json() as { recoverableCount: number; results: Array<{ uid: string; status: string }> };
    assert.equal(result.recoverableCount, 1);
    assert.equal(result.results[0].status, "recoverable");
    assert.ok((await db.collection("authCleanupTasks").doc(result.results[0].uid).get()).exists);
    await db.collection("platformPlanCatalog").doc("basic").update({ "limits.maxUsers": 2 });
  } finally {
    auth.deleteUser = deleteUser;
  }
  const recovered = await importRequest(authTokens.tenantB, recoverableBatchId);
  const recoveredBody = await recovered.json() as { status: string; createdCount: number; results: Array<{ uid: string }> };
  assert.equal(recoveredBody.status, "completed");
  assert.equal(recoveredBody.createdCount, 1);
  assert.equal((await db.collection("users").doc(recoveredBody.results[0].uid).get()).get("institutionId"), "route-institution-b");
  assert.equal((await db.collection("authCleanupTasks").doc(recoveredBody.results[0].uid).get()).exists, false);
});

test("employee import upload enforces access, supported formats, and institution isolation", async () => {
  const { DELETE: cancelImport, POST: uploadImport } = await import("../app/api/employees/import/route");
  const { POST: confirmImport } = await import("../app/api/employees/import/confirm/route");
  const existingRef = db.collection("users").doc("employee-import-cross-tenant");
  let batchId: string | undefined;
  const uploadRequest = (token: string | undefined, fileName: string, content: string) => {
    const form = new FormData();
    form.append("file", new Blob([content], { type: "text/csv" }), fileName);
    return new Request("http://localhost/api/employees/import", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    });
  };
  const uploadWorkbook = (token: string | undefined, fileName: string, bytes: Uint8Array) => {
    const form = new FormData();
    const fileBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(fileBuffer).set(bytes);
    form.append("file", new Blob([fileBuffer], { type: "application/octet-stream" }), fileName);
    return new Request("http://localhost/api/employees/import", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    });
  };

  await existingRef.set({
    uid: existingRef.id,
    institutionId: "route-institution-a",
    fullName: "Employee in Another Institution",
    email: "cross-tenant-import@example.test",
    status: "active",
    role: "Employee",
  });

  try {
    assert.equal((await uploadImport(uploadRequest(undefined, "employees.csv", "name,email\nA,a@example.test"))).status, 401);
    assert.equal((await uploadImport(uploadRequest(authTokens.manager, "employees.csv", "name,email\nA,a@example.test"))).status, 403);
    assert.equal((await uploadImport(uploadRequest(authTokens.owner, "employees.xlsx", "name,email\nA,a@example.test"))).status, 400);
    assert.equal((await uploadImport(uploadRequest(authTokens.owner, "employees.xls", "name,email\nA,a@example.test"))).status, 400);
    assert.equal((await uploadImport(uploadRequest(authTokens.owner, "employees.xlsm", "name,email\nA,a@example.test"))).status, 400);
    const renamedText = await uploadImport(uploadWorkbook(authTokens.tenantB, "renamed.xlsx", Buffer.from("not a workbook")));
    assert.equal(renamedText.status, 400);
    const renamedCsv = await uploadImport(uploadWorkbook(authTokens.tenantB, "renamed.xlsx", Buffer.from("name,email\nA,a@example.test")));
    assert.equal(renamedCsv.status, 400);
    assert.equal((await renamedCsv.json() as { error: string }).error, "The uploaded file is not a valid supported XLSX workbook.");

    const invalid = await uploadImport(uploadRequest(authTokens.tenantB, "employees.csv", "name,email\nA,\"unfinished"),);
    assert.equal(invalid.status, 400);
    const invalidBody = await invalid.json() as { error: string };
    assert.equal(invalidBody.error, "The uploaded file is not a valid UTF-8 CSV file.");
    assert.doesNotMatch(invalidBody.error, /record length|stack|exception/i);

    const oversized = await uploadImport(uploadRequest(
      authTokens.tenantB,
      "oversized.csv",
      "x".repeat(5 * 1024 * 1024 + 64 * 1024 + 1),
    ));
    assert.equal(oversized.status, 400);
    assert.match((await oversized.json() as { error: string }).error, /5 MB/);

    const response = await uploadImport(uploadRequest(
      authTokens.tenantB,
      "employees.csv",
      "Full Name,Employee ID,Email,Department,Role\nTenant B Candidate,TENANT-B-001,cross-tenant-import@example.test,Operations,Employee",
    ));
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json() as { batchId: string; preview: Array<{ duplicateState: string; allowed: boolean }> };
    batchId = body.batchId;
    assert.equal(body.preview[0].duplicateState, "New");
    assert.equal(body.preview[0].allowed, true);
    const batch = await db.collection("bulkImportBatches").doc(body.batchId).get();
    assert.equal(batch.get("institutionId"), "route-institution-b");
    assert.equal(batch.get("sourceType"), "csv");
    const audit = await db.collection("securityEvents")
      .where("source", "==", "employees.import")
      .where("details.batchId", "==", body.batchId)
      .limit(1)
      .get();
    assert.equal(audit.size, 1);
    assert.equal(audit.docs[0].get("institutionId"), "route-institution-b");
    const crossTenantCancellation = await cancelImport(new Request("http://localhost/api/employees/import", {
      method: "DELETE",
      headers: { authorization: `Bearer ${authTokens.tenant}`, "content-type": "application/json" },
      body: JSON.stringify({ batchId: body.batchId }),
    }));
    assert.equal(crossTenantCancellation.status, 404);
    const cancellation = await cancelImport(new Request("http://localhost/api/employees/import", {
      method: "DELETE",
      headers: { authorization: `Bearer ${authTokens.tenantB}`, "content-type": "application/json" },
      body: JSON.stringify({ batchId: body.batchId }),
    }));
    assert.equal(cancellation.status, 200, await cancellation.clone().text());
    assert.equal((await db.collection("bulkImportBatches").doc(body.batchId).get()).get("status"), "cancelled");
    const cancelledConfirmation = await confirmImport(new Request("http://localhost/api/employees/import/confirm", {
      method: "POST",
      headers: { authorization: `Bearer ${authTokens.tenantB}`, "content-type": "application/json" },
      body: JSON.stringify({ batchId: body.batchId }),
    }));
    assert.equal(cancelledConfirmation.status, 409);
    const cancellationAudit = await db.collection("securityEvents")
      .where("source", "==", "employees.import")
      .where("details.batchId", "==", body.batchId)
      .where("details.action", "==", "bulk_import_cancelled")
      .limit(1)
      .get();
    assert.equal(cancellationAudit.size, 1);
  } finally {
    if (batchId) {
      await db.collection("bulkImportBatches").doc(batchId).delete();
      const audit = await db.collection("securityEvents")
        .where("source", "==", "employees.import")
        .where("details.batchId", "==", batchId)
        .get();
      await Promise.all(audit.docs.map((document) => document.ref.delete()));
    }
    await existingRef.delete();
  }
});

test("employee XLSX preview and confirmation reuse the tenant-scoped employee workflow", async () => {
  const { POST: uploadImport } = await import("../app/api/employees/import/route");
  const { POST: confirmImport } = await import("../app/api/employees/import/confirm/route");
  const departmentRef = db.collection("departments").doc("xlsx-import-department");
  await departmentRef.set({
    departmentId: departmentRef.id,
    institutionId: "route-institution-c",
    name: "Operations",
    status: "active",
  });
  let batchId: string | undefined;
  let employeeUid: string | undefined;
  const form = new FormData();
  form.append("file", new Blob([makeEmployeeXlsx({
    rows: [
      ["Full Name", "Email", "Department", "Role", "Employee ID", "Phone", "Tenant"],
      ["XLSX Employee", "xlsx-employee@example.test", departmentRef.id, "Employee", "0000123", "001-234", "route-institution-a"],
    ],
  })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "employees.xlsx");
  try {
    const previewResponse = await uploadImport(new Request("http://localhost/api/employees/import", {
      method: "POST",
      headers: { authorization: `Bearer ${authTokens.tenantC}` },
      body: form,
    }));
    assert.equal(previewResponse.status, 200, await previewResponse.clone().text());
    const preview = await previewResponse.json() as { batchId: string; preview: Array<{ allowed: boolean; institutionEmployeeId: string }> };
    batchId = preview.batchId;
    assert.equal(preview.preview[0].allowed, true);
    assert.equal(preview.preview[0].institutionEmployeeId, "0000123");
    const batch = await db.collection("bulkImportBatches").doc(batchId).get();
    assert.equal(batch.get("sourceType"), "xlsx");
    assert.equal(batch.get("institutionId"), "route-institution-c");

    const confirmation = await confirmImport(new Request("http://localhost/api/employees/import/confirm", {
      method: "POST",
      headers: { authorization: `Bearer ${authTokens.tenantC}`, "content-type": "application/json" },
      body: JSON.stringify({ batchId }),
    }));
    assert.equal(confirmation.status, 200, await confirmation.clone().text());
    const result = await confirmation.json() as { status: string; createdCount: number; results: Array<{ uid: string }> };
    assert.equal(result.status, "completed");
    assert.equal(result.createdCount, 1);
    employeeUid = result.results[0].uid;
    const employee = await db.collection("users").doc(employeeUid).get();
    assert.equal(employee.get("institutionId"), "route-institution-c");
    assert.equal(employee.get("institutionEmployeeId"), "0000123");
    assert.equal(employee.get("phone"), "001-234");
    assert.equal(employee.get("role"), "Employee");
    assert.equal((await auth.getUser(employeeUid)).email, "xlsx-employee@example.test");
  } finally {
    if (employeeUid) {
      await db.collection("users").doc(employeeUid).delete();
      await auth.deleteUser(employeeUid);
    }
    if (batchId) {
      await db.collection("bulkImportBatches").doc(batchId).delete();
      const auditEvents = await db.collection("securityEvents").where("details.batchId", "==", batchId).get();
      await Promise.all(auditEvents.docs.map((document) => document.ref.delete()));
    }
    await departmentRef.delete();
  }
});

test("employee import aborts the batch if its audit write fails", async () => {
  const { POST: uploadImport } = await import("../app/api/employees/import/route");
  const form = new FormData();
  form.append("file", new Blob([
    "Full Name,Employee ID,Email,Department,Role\nAudit Failure,TENANT-A-002,audit-failure@example.test,Operations,Employee",
  ], { type: "text/csv" }), "audit-failure.csv");
  const request = new Request("http://localhost/api/employees/import", {
    method: "POST",
    headers: { authorization: `Bearer ${authTokens.owner}` },
    body: form,
  });
  const attemptedPaths: string[] = [];
  const originalRunTransaction = db.runTransaction.bind(db);
  const originalDescriptor = Object.getOwnPropertyDescriptor(db, "runTransaction");

  Object.defineProperty(db, "runTransaction", {
    configurable: true,
    value: (updateFunction: (transaction: import("firebase-admin/firestore").Transaction) => Promise<unknown>) =>
      originalRunTransaction((transaction) => updateFunction(new Proxy(transaction, {
        get(target, property) {
          const member = Reflect.get(target, property, target);
          if (property === "create" || property === "set") {
            return (...args: unknown[]) => {
              const reference = args[0] as { path?: string };
              if (reference.path) attemptedPaths.push(reference.path);
              if (reference.path?.startsWith("securityEvents/")) throw new Error("simulated audit write failure");
              return Reflect.apply(member, target, args);
            };
          }
          return typeof member === "function" ? member.bind(target) : member;
        },
      }) as import("firebase-admin/firestore").Transaction)),
  });

  try {
    const response = await uploadImport(request);
    assert.equal(response.status, 500);
    const batchPath = attemptedPaths.find((path) => path.startsWith("bulkImportBatches/"));
    const auditPath = attemptedPaths.find((path) => path.startsWith("securityEvents/"));
    assert.ok(batchPath, "batch write was staged before the audit write");
    assert.ok(auditPath, "audit write failure was exercised");
    assert.equal((await db.doc(batchPath).get()).exists, false);
    assert.equal((await db.doc(auditPath).get()).exists, false);
  } finally {
    if (originalDescriptor) Object.defineProperty(db, "runTransaction", originalDescriptor);
    else delete (db as unknown as { runTransaction?: unknown }).runTransaction;
  }
});

test("employee import accepts valid session cookies and rejects invalid session states", async () => {
  const { POST: uploadImport } = await import("../app/api/employees/import/route");
  const { getSessionToken, sessionTokenHash, verifyActiveSession } = await import("../lib/firebase/server-auth");
  const account = await createAuthenticatedUser("employee-import-cookie@example.test", "Veqweris-Route-Test-cookie!");
  const profileRef = db.collection("users").doc(account.uid);
  const sessionRef = db.collection("securitySessions").doc(sessionTokenHash(account.token));
  const batchIds: string[] = [];

  await profileRef.set({
    uid: account.uid,
    institutionId: "route-institution-a",
    role: "Owner",
    status: "active",
  });
  const requestFor = (cookie?: string) => {
    const form = new FormData();
    form.append("file", new Blob([
      "Full Name,Employee ID,Email,Department,Role\nCookie User,COOKIE-001,cookie-import@example.test,Operations,Employee",
    ], { type: "text/csv" }), "cookie-import.csv");
    return new Request("http://localhost/api/employees/import", {
      method: "POST",
      headers: cookie ? { cookie } : {},
      body: form,
    });
  };

  try {
    assert.equal(await getSessionToken(requestFor()), null);
    await assert.rejects(verifyActiveSession("invalid-session-token"));

    const validResponse = await uploadImport(requestFor(`__session=${encodeURIComponent(account.token)}`));
    assert.equal(validResponse.status, 200, await validResponse.clone().text());
    const validBody = await validResponse.json() as { batchId: string };
    batchIds.push(validBody.batchId);

    await sessionRef.update({ status: "revoked" });
    await assert.rejects(verifyActiveSession(account.token), /revoked/);
    await sessionRef.update({
      status: "active",
      expiresAt: new Date(Date.now() - 60_000),
    });
    await assert.rejects(verifyActiveSession(account.token), /expired/);
    assert.equal((await sessionRef.get()).get("status"), "expired");
    await sessionRef.update({
      status: "active",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    await sessionRef.update({ expiresAt: null });
    await assert.rejects(verifyActiveSession(account.token), /expiry is invalid/);
    assert.equal((await sessionRef.get()).get("status"), "expired");
    await sessionRef.update({
      status: "active",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    await profileRef.update({ status: "inactive" });
    await assert.rejects(verifyActiveSession(account.token), /not active/);
  } finally {
    for (const batchId of batchIds) {
      await db.collection("bulkImportBatches").doc(batchId).delete();
      const audit = await db.collection("securityEvents")
        .where("source", "==", "employees.import")
        .where("details.batchId", "==", batchId)
        .get();
      await Promise.all(audit.docs.map((document) => document.ref.delete()));
    }
    await profileRef.delete();
    await sessionRef.delete();
    await auth.deleteUser(account.uid);
  }
});

test("organization role and membership routes protect tenant scope and enforce idempotency", async () => {
  const roles = await import("../app/api/organization/roles/route");
  const memberships = await import("../app/api/organization/memberships/route");
  const institutionId = "organization-routes-test-institution";
  const institutionB = "organization-routes-test-other-institution";
  const actor = await createAuthenticatedUser("organization-owner@example.test", "Veqweris-Route-Test-9!");
  const target = await createAuthenticatedUser("organization-employee@example.test", "Veqweris-Route-Test-10!");
  const protectedOwner = await createAuthenticatedUser("organization-other-owner@example.test", "Veqweris-Route-Test-11!");
  const otherTenantMember = await createAuthenticatedUser("organization-other-tenant@example.test", "Veqweris-Route-Test-12!");
  const generatedRoleIds: string[] = [];
  const additionalSessionTokens: string[] = [];

  const request = (route: "roles" | "memberships", token: string, body: Record<string, unknown>) =>
    new Request(`http://localhost/api/organization/${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  let refreshedActorToken = "";
  try {
    await db.collection("institutions").doc(institutionId).set({
      institutionId, name: institutionId, status: "active", planTier: "enterprise",
    });
    await db.collection("institutions").doc(institutionB).set({
      institutionId: institutionB, name: institutionB, status: "active", planTier: "enterprise",
    });
    const membership = (uid: string, tier: "Owner" | "Employee", memberInstitutionId: string) => ({
      uid, institutionId: memberInstitutionId, tier, roleIds: [], departmentIds: [], unitIds: [], teamIds: [], locationIds: [],
      permissionVersion: 1, sensitivityCeiling: tier === "Owner" ? "RESTRICTED" : "INTERNAL", status: "active",
    });
    await Promise.all([
      db.collection("users").doc(actor.uid).set({ uid: actor.uid, institutionId, role: "Owner", status: "active" }),
      db.collection("users").doc(target.uid).set({ uid: target.uid, institutionId, role: "Employee", status: "active" }),
      db.collection("users").doc(protectedOwner.uid).set({ uid: protectedOwner.uid, institutionId, role: "Owner", status: "active" }),
      db.collection("users").doc(otherTenantMember.uid).set({
        uid: otherTenantMember.uid, institutionId: institutionB, role: "Employee", status: "active",
      }),
      db.collection("memberships").doc(actor.uid).set(membership(actor.uid, "Owner", institutionId)),
      db.collection("memberships").doc(target.uid).set(membership(target.uid, "Employee", institutionId)),
      db.collection("memberships").doc(protectedOwner.uid).set(membership(protectedOwner.uid, "Owner", institutionId)),
      db.collection("memberships").doc(otherTenantMember.uid).set(membership(otherTenantMember.uid, "Employee", institutionB)),
    ]);
    const grants = ["organization.roles.manage", "organization.memberships.manage"]
      .map((key) => ({ key, scope: { institutionId } }));
    await db.collection("effectivePermissions").doc(actor.uid).set({
      uid: actor.uid, institutionId, version: 1, grants, permissionKeys: grants.map(({ key }) => key), status: "active",
    });

    await auth.setCustomUserClaims(actor.uid, { iid: institutionId, tier: "Owner", pt: "staff", pv: 1 });
    const signIn = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=organization-route-tests`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "organization-owner@example.test",
          password: "Veqweris-Route-Test-9!",
          returnSecureToken: true,
        }),
      },
    );
    const signInBody = await signIn.text();
    assert.equal(signIn.status, 200, `Auth emulator sign-in failed: ${signInBody}`);
    refreshedActorToken = (JSON.parse(signInBody) as { idToken: string }).idToken;
    await db.collection("securitySessions").doc(sessionTokenHash(refreshedActorToken)).set({
      uid: actor.uid, status: "active", expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const roleBody = {
      name: "Route test role",
      permissions: [],
      reason: "Route regression test",
      idempotencyKey: "organization-role-route-test-1",
    };
    const created = await roles.POST(request("roles", refreshedActorToken, roleBody));
    assert.equal(created.status, 201, await created.clone().text());
    const createdRole = await created.json() as { roleId: string };
    generatedRoleIds.push(createdRole.roleId);
    const replay = await roles.POST(request("roles", refreshedActorToken, roleBody));
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as { replay: boolean }).replay, true);
    assert.equal((await roles.POST(request("roles", refreshedActorToken, {
      ...roleBody, name: "Changed request with reused key",
    }))).status, 409);
    assert.equal((await db.collection("securityEvents")
      .where("source", "==", "organization.roles")
      .where("details.reference", "==", createdRole.roleId).get()).size, 1);

    const membershipBody = {
      uid: target.uid, roleIds: [], departmentIds: [], reason: "Assign empty scope",
      idempotencyKey: "organization-membership-route-test-1",
    };
    const assigned = await memberships.POST(request("memberships", refreshedActorToken, membershipBody));
    assert.equal(assigned.status, 200, await assigned.clone().text());
    const replayedMembership = await memberships.POST(request("memberships", refreshedActorToken, membershipBody));
    assert.equal(replayedMembership.status, 200);
    assert.equal((await replayedMembership.json() as { replay: boolean }).replay, true);
    assert.equal((await memberships.POST(request("memberships", refreshedActorToken, {
      ...membershipBody, status: "inactive",
    }))).status, 409);

    assert.equal((await memberships.POST(request("memberships", refreshedActorToken, {
      uid: protectedOwner.uid, status: "inactive", reason: "Must not alter an Owner",
      idempotencyKey: "organization-owner-protection-test-1",
    }))).status, 403);
    assert.equal((await memberships.POST(request("memberships", refreshedActorToken, {
      uid: otherTenantMember.uid, status: "inactive", reason: "Cross-tenant attempt",
      idempotencyKey: "organization-cross-tenant-test-1",
    }))).status, 404);
    assert.equal((await db.collection("users").doc(otherTenantMember.uid).get()).get("status"), "active");

    await db.collection("users").doc(actor.uid).update({ institutionId: institutionB });
    await db.collection("memberships").doc(actor.uid).update({ institutionId: institutionB });
    await db.collection("effectivePermissions").doc(actor.uid).update({
      institutionId: institutionB,
      grants: grants.map(({ key }) => ({ key, scope: { institutionId: institutionB } })),
    });
    await db.collection("users").doc(target.uid).update({ institutionId: institutionB });
    await db.collection("memberships").doc(target.uid).set(membership(target.uid, "Employee", institutionB));
    await auth.setCustomUserClaims(actor.uid, { iid: institutionB, tier: "Owner", pt: "staff", pv: 1 });
    const secondSignIn = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=organization-route-tests`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "organization-owner@example.test",
          password: "Veqweris-Route-Test-9!",
          returnSecureToken: true,
        }),
      },
    );
    const secondSignInBody = await secondSignIn.text();
    assert.equal(secondSignIn.status, 200, `Second auth emulator sign-in failed: ${secondSignInBody}`);
    const secondTenantToken = (JSON.parse(secondSignInBody) as { idToken: string }).idToken;
    additionalSessionTokens.push(secondTenantToken);
    await db.collection("securitySessions").doc(sessionTokenHash(secondTenantToken)).set({
      uid: actor.uid, status: "active", expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const secondTenantRole = await roles.POST(request("roles", secondTenantToken, roleBody));
    assert.equal(secondTenantRole.status, 201, await secondTenantRole.clone().text());
    const secondRoleBody = await secondTenantRole.json() as { roleId: string };
    generatedRoleIds.push(secondRoleBody.roleId);
    assert.notEqual(secondRoleBody.roleId, createdRole.roleId);

    const secondTenantMembership = await memberships.POST(request("memberships", secondTenantToken, membershipBody));
    assert.equal(secondTenantMembership.status, 200, await secondTenantMembership.clone().text());
    assert.equal((await secondTenantMembership.json() as { replay: boolean }).replay, false);
    assert.equal((await db.collection("memberships").doc(target.uid).get()).get("permissionVersion"), 2);
  } finally {
    for (const roleId of generatedRoleIds) {
      const versions = await db.collection("roleVersions").where("roleId", "==", roleId).get();
      await Promise.all(versions.docs.map((snapshot) => snapshot.ref.delete()));
      await db.collection("roles").doc(roleId).delete();
    }
    const [audits, idempotency] = await Promise.all([
      db.collection("securityEvents").where("institutionId", "in", [institutionId, institutionB]).get(),
      db.collection("requestIdempotency").where("institutionId", "in", [institutionId, institutionB]).get(),
    ]);
    await Promise.all([...audits.docs, ...idempotency.docs].map((snapshot) => snapshot.ref.delete()));
    const users = [actor.uid, target.uid, protectedOwner.uid, otherTenantMember.uid];
    await Promise.all(users.flatMap((uid) => [
      db.collection("users").doc(uid).delete(),
      db.collection("memberships").doc(uid).delete(),
      db.collection("effectivePermissions").doc(uid).delete(),
    ]));
    await Promise.all([
      db.collection("institutions").doc(institutionId).delete(),
      db.collection("institutions").doc(institutionB).delete(),
    ]);
    for (const token of [
      actor.token, refreshedActorToken, ...additionalSessionTokens, target.token, protectedOwner.token, otherTenantMember.token,
    ]) {
      if (token) await db.collection("securitySessions").doc(sessionTokenHash(token)).delete();
    }
    await Promise.all([actor, target, protectedOwner, otherTenantMember].map(({ uid }) => auth.deleteUser(uid)));
  }
});

test("scope-limited administrators cannot change members or assignments outside their scope", async () => {
  const memberships = await import("../app/api/organization/memberships/route");
  const institutionId = "organization-scoped-route-test-institution";
  const departmentA = "organization-scoped-route-test-department-a";
  const departmentB = "organization-scoped-route-test-department-b";
  const adminAccount = await createAuthenticatedUser("organization-scoped-admin@example.test", "Veqweris-Route-Test-13!");
  const inScopeMember = await createAuthenticatedUser("organization-in-scope-member@example.test", "Veqweris-Route-Test-14!");
  const outOfScopeMember = await createAuthenticatedUser("organization-out-scope-member@example.test", "Veqweris-Route-Test-15!");
  let scopedToken = "";

  try {
    await db.collection("institutions").doc(institutionId).set({
      institutionId, name: institutionId, status: "active", planTier: "enterprise",
    });
    await Promise.all([
      db.collection("departments").doc(departmentA).set({ institutionId, name: "Department A" }),
      db.collection("departments").doc(departmentB).set({ institutionId, name: "Department B" }),
      db.collection("users").doc(adminAccount.uid).set({
        uid: adminAccount.uid, institutionId, role: "Admin", status: "active",
      }),
      db.collection("users").doc(inScopeMember.uid).set({
        uid: inScopeMember.uid, institutionId, role: "Employee", status: "active", departmentId: departmentA,
      }),
      db.collection("users").doc(outOfScopeMember.uid).set({
        uid: outOfScopeMember.uid, institutionId, role: "Employee", status: "active", departmentId: departmentB,
      }),
    ]);
    const membership = (uid: string, tier: "Admin" | "Employee", departmentIds: string[]) => ({
      uid, institutionId, tier, roleIds: [], departmentIds, unitIds: [], teamIds: [], locationIds: [],
      permissionVersion: 1, sensitivityCeiling: tier === "Admin" ? "RESTRICTED" : "INTERNAL", status: "active",
    });
    await Promise.all([
      db.collection("memberships").doc(adminAccount.uid).set(membership(adminAccount.uid, "Admin", [departmentA])),
      db.collection("memberships").doc(inScopeMember.uid).set(membership(inScopeMember.uid, "Employee", [departmentA])),
      db.collection("memberships").doc(outOfScopeMember.uid).set(membership(outOfScopeMember.uid, "Employee", [departmentB])),
    ]);
    const grants = [{
      key: "organization.memberships.manage",
      scope: { institutionId, departmentIds: [departmentA] },
    }];
    await db.collection("effectivePermissions").doc(adminAccount.uid).set({
      uid: adminAccount.uid, institutionId, version: 1, grants,
      permissionKeys: grants.map(({ key }) => key), status: "active",
    });
    await auth.setCustomUserClaims(adminAccount.uid, { iid: institutionId, tier: "Admin", pt: "staff", pv: 1 });
    const signIn = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=organization-scoped-route-tests`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "organization-scoped-admin@example.test",
          password: "Veqweris-Route-Test-13!",
          returnSecureToken: true,
        }),
      },
    );
    const signInBody = await signIn.text();
    assert.equal(signIn.status, 200, `Auth emulator sign-in failed: ${signInBody}`);
    scopedToken = (JSON.parse(signInBody) as { idToken: string }).idToken;
    await db.collection("securitySessions").doc(sessionTokenHash(scopedToken)).set({
      uid: adminAccount.uid, status: "active", expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const request = (body: Record<string, unknown>) => new Request("http://localhost/api/organization/memberships", {
      method: "POST",
      headers: { authorization: `Bearer ${scopedToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const outsideTarget = await memberships.POST(request({
      uid: outOfScopeMember.uid,
      status: "inactive",
      reason: "Out-of-scope target test",
      idempotencyKey: "organization-scoped-target-test-1",
    }));
    assert.equal(outsideTarget.status, 403, await outsideTarget.clone().text());
    const outsideAssignment = await memberships.POST(request({
      uid: inScopeMember.uid,
      departmentIds: [departmentB],
      reason: "Out-of-scope assignment test",
      idempotencyKey: "organization-scoped-assignment-test-1",
    }));
    assert.equal(outsideAssignment.status, 403, await outsideAssignment.clone().text());
    assert.equal((await db.collection("users").doc(outOfScopeMember.uid).get()).get("status"), "active");
    assert.deepEqual((await db.collection("memberships").doc(inScopeMember.uid).get()).get("departmentIds"), [departmentA]);
  } finally {
    const userIds = [adminAccount.uid, inScopeMember.uid, outOfScopeMember.uid];
    await Promise.all([
      ...userIds.flatMap((uid) => [
        db.collection("users").doc(uid).delete(),
        db.collection("memberships").doc(uid).delete(),
        db.collection("effectivePermissions").doc(uid).delete(),
        auth.deleteUser(uid),
      ]),
      db.collection("departments").doc(departmentA).delete(),
      db.collection("departments").doc(departmentB).delete(),
      db.collection("institutions").doc(institutionId).delete(),
    ]);
    const sessions = await db.collection("securitySessions").where("uid", "in", [adminAccount.uid, inScopeMember.uid, outOfScopeMember.uid]).get();
    await Promise.all(sessions.docs.map((session) => session.ref.delete()));
    if (scopedToken) await db.collection("securitySessions").doc(sessionTokenHash(scopedToken)).delete();
  }
});

test("new accounts establish a pending session before idempotent institution provisioning", async () => {
  const sessionRoute = await import("../app/api/auth/session/route");
  const provisioningRoute = await import("../app/api/organization/provision/route");
  const account = await createAuthenticatedUser("new-provisioning-user@example.test", "Veqweris-Route-Test-16!");
  const idempotencyKey = "new-provisioning-user-route-test-1";
  let provisioningId = "";
  let refreshedToken = "";

  try {
    const initialSession = await sessionRoute.POST(new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: account.token, sessionPolicy: "7_days" }),
    }));
    assert.equal(initialSession.status, 200);
    assert.equal((await initialSession.json() as { refreshRequired: boolean }).refreshRequired, true);

    const signIn = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=provisioning-route-tests`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "new-provisioning-user@example.test",
          password: "Veqweris-Route-Test-16!",
          returnSecureToken: true,
        }),
      },
    );
    const signInBody = await signIn.text();
    assert.equal(signIn.status, 200, `Auth emulator sign-in failed: ${signInBody}`);
    refreshedToken = (JSON.parse(signInBody) as { idToken: string }).idToken;
    const activeSession = await sessionRoute.POST(new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: refreshedToken, sessionPolicy: "7_days" }),
    }));
    assert.equal(activeSession.status, 200, await activeSession.clone().text());

    const payload = {
      institutionName: "Provisioning Route Test",
      country: "United States",
      fullName: "New Provisioning User",
      email: "new-provisioning-user@example.test",
      institutionType: "general-business",
      idempotencyKey,
    };
    const provision = () => provisioningRoute.POST(new Request("http://localhost/api/organization/provision", {
      method: "POST",
      headers: { authorization: `Bearer ${refreshedToken}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));
    const created = await provision();
    assert.equal(created.status, 201, await created.clone().text());
    const result = await created.json() as { institutionId: string; status: string };
    provisioningId = result.institutionId;
    assert.equal(result.status, "completed");
    assert.equal((await db.collection("institutions").doc(provisioningId).get()).get("createdBy"), account.uid);
    assert.equal((await db.collection("users").doc(account.uid).get()).get("institutionId"), provisioningId);
    assert.equal((await db.collection("memberships").doc(account.uid).get()).get("tier"), "Owner");
    assert.equal((await db.collection("locations").doc(`${provisioningId}_main`).get()).get("institutionId"), provisioningId);
    assert.equal((await provision()).status, 200);
    const conflict = await provisioningRoute.POST(new Request("http://localhost/api/organization/provision", {
      method: "POST",
      headers: { authorization: `Bearer ${refreshedToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ...payload, institutionName: "Conflicting intent" }),
    }));
    assert.equal(conflict.status, 409);
    assert.equal((await auth.getUser(account.uid)).customClaims?.pt, "staff");
  } finally {
    if (provisioningId) {
      await Promise.all([
        db.collection("institutions").doc(provisioningId).delete(),
        db.collection("locations").doc(`${provisioningId}_main`).delete(),
        db.collection("securityEvents").doc(`institution_provisioning_${provisioningId}`).delete(),
      ]);
      const runs = await db.collection("institutionProvisioningRuns").where("institutionId", "==", provisioningId).get();
      await Promise.all(runs.docs.map((run) => run.ref.delete()));
    }
    const idempotencyHash = createHash("sha256")
      .update(`${account.uid}:${idempotencyKey}`)
      .digest("hex");
    await Promise.all([
      db.collection("requestIdempotency").doc(`provisioning:${idempotencyHash}`).delete(),
      db.collection("users").doc(account.uid).delete(),
      db.collection("memberships").doc(account.uid).delete(),
      db.collection("effectivePermissions").doc(account.uid).delete(),
      auth.deleteUser(account.uid),
    ]);
    const tokens = [account.token, refreshedToken].filter(Boolean);
    await Promise.all(tokens.map((token) => db.collection("securitySessions").doc(sessionTokenHash(token)).delete()));
  }
});

test("institution settings enforce permission, validation, scoped idempotency, drafts, and audit", async () => {
  const settings = await import("../app/api/settings/route");
  const institutionA = "settings-routes-institution-a";
  const institutionB = "settings-routes-institution-b";
  const ownerA = await createAuthenticatedUser("settings-owner-a@example.test", "Veqweris-Settings-Test-1!");
  const ownerB = await createAuthenticatedUser("settings-owner-b@example.test", "Veqweris-Settings-Test-2!");
  const employee = await createAuthenticatedUser("settings-employee@example.test", "Veqweris-Settings-Test-3!");
  const tokens: string[] = [];

  async function preparePrincipal(
    account: { uid: string; token: string },
    institutionId: string,
    tier: "Owner" | "Employee",
    withGrant: boolean,
  ) {
    await db.collection("users").doc(account.uid).set({
      uid: account.uid, institutionId, role: tier, status: "active",
    });
    await db.collection("memberships").doc(account.uid).set({
      uid: account.uid, institutionId, tier, roleIds: [], departmentIds: [], unitIds: [], teamIds: [], locationIds: [],
      permissionVersion: 1, sensitivityCeiling: tier === "Owner" ? "RESTRICTED" : "INTERNAL", status: "active",
    });
    const grants = withGrant ? [{ key: "organization.roles.manage", scope: { institutionId } }] : [];
    await db.collection("effectivePermissions").doc(account.uid).set({
      uid: account.uid, institutionId, version: 1, grants, permissionKeys: grants.map(({ key }) => key), status: "active",
    });
    await auth.setCustomUserClaims(account.uid, { iid: institutionId, tier, pt: "staff", pv: 1 });
    const signedIn = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=settings-route-tests`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: tier === "Owner" ? `settings-owner-${institutionId.endsWith("a") ? "a" : "b"}@example.test` : "settings-employee@example.test",
          password: tier === "Owner"
            ? `Veqweris-Settings-Test-${institutionId.endsWith("a") ? "1" : "2"}!`
            : "Veqweris-Settings-Test-3!",
          returnSecureToken: true,
        }),
      },
    );
    const responseText = await signedIn.text();
    assert.equal(signedIn.status, 200, `Settings auth sign-in failed: ${responseText}`);
    const token = (JSON.parse(responseText) as { idToken: string }).idToken;
    tokens.push(token);
    await db.collection("securitySessions").doc(sessionTokenHash(token)).set({
      uid: account.uid, institutionId, status: "active", expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    return token;
  }

  const request = (token: string, payload?: Record<string, unknown>) => new Request("http://localhost/api/settings", {
    method: payload ? "POST" : "GET",
    headers: { authorization: ["Bearer", token].join(" "), ...(payload ? { "content-type": "application/json" } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  try {
    await Promise.all([institutionA, institutionB].map((institutionId) =>
      db.collection("institutions").doc(institutionId).set({
        institutionId, name: institutionId, status: "active", planTier: "enterprise",
      })));
    const [ownerAToken, ownerBToken, employeeToken] = await Promise.all([
      preparePrincipal(ownerA, institutionA, "Owner", true),
      preparePrincipal(ownerB, institutionB, "Owner", true),
      preparePrincipal(employee, institutionA, "Employee", false),
    ]);

    assert.equal((await settings.GET(request(""))).status, 401);
    assert.equal((await settings.GET(request(employeeToken))).status, 403);
    assert.equal((await settings.GET(request(ownerAToken))).status, 200);

    const invalid = await settings.POST(request(ownerAToken, {
      sectionId: "profile", action: "save", reason: "Update profile", idempotencyKey: "settings-invalid-key-01",
      values: { "profile.legalName": "Valid", "security.sessionTimeoutMinutes": 30 },
    }));
    assert.equal(invalid.status, 400);

    const savePayload = {
      sectionId: "profile", action: "save", reason: "Correct trading name",
      idempotencyKey: "settings-profile-update-001", values: { "profile.tradingName": "A Trading Company" },
    };
    const saved = await settings.POST(request(ownerAToken, savePayload));
    assert.equal(saved.status, 201, await saved.clone().text());
    assert.deepEqual((await saved.json() as { values: Record<string, unknown> }).values, {
      "profile.tradingName": "A Trading Company",
    });
    assert.equal((await settings.POST(request(ownerAToken, savePayload))).status, 200);
    assert.equal((await settings.POST(request(ownerAToken, {
      ...savePayload, values: { "profile.tradingName": "Different" },
    }))).status, 409);
    const activeSection = await db.collection("institutionSettings").doc(institutionA)
      .collection("sections").doc("profile").get();
    assert.equal(activeSection.get("institutionId"), institutionA);
    assert.equal((activeSection.get("values") as Record<string, unknown>)["profile.tradingName"], "A Trading Company");

    const draftKey = "settings-locale-draft-001";
    const draft = await settings.POST(request(ownerAToken, {
      sectionId: "locale", action: "draft", reason: "Timezone change for operations",
      idempotencyKey: draftKey, values: { "locale.timezone": "Africa/Nairobi" },
    }));
    assert.equal(draft.status, 201, await draft.clone().text());
    assert.equal((await db.collection("institutionSettings").doc(institutionA)
      .collection("sections").doc("locale").get()).exists, false, "drafts do not change active settings");
    const published = await settings.POST(request(ownerAToken, {
      sectionId: "locale", action: "publish", reason: "Timezone changed after impact review",
      draftId: draftKey, idempotencyKey: "settings-locale-publish-001",
    }));
    assert.equal(published.status, 201, await published.clone().text());
    const activeLocale = await db.collection("institutionSettings").doc(institutionA)
      .collection("sections").doc("locale").get();
    assert.equal((activeLocale.get("values") as Record<string, unknown>)["locale.timezone"], "Africa/Nairobi");
    assert.equal((await settings.POST(request(ownerAToken, {
      sectionId: "locale", action: "publish", reason: "Timezone changed after impact review",
      draftId: draftKey, idempotencyKey: "settings-locale-publish-001",
    }))).status, 200);

    const forgedTenantWrite = await settings.POST(request(ownerBToken, {
      ...savePayload, institutionId: institutionA, idempotencyKey: "settings-forged-tenant-001",
    }));
    assert.equal(forgedTenantWrite.status, 201, await forgedTenantWrite.clone().text());
    const [tenantAProfile, tenantBProfile] = await Promise.all([
      db.collection("institutionSettings").doc(institutionA).collection("sections").doc("profile").get(),
      db.collection("institutionSettings").doc(institutionB).collection("sections").doc("profile").get(),
    ]);
    assert.equal((tenantAProfile.get("values") as Record<string, unknown>)["profile.tradingName"], "A Trading Company");
    assert.equal((tenantBProfile.get("values") as Record<string, unknown>)["profile.tradingName"], "A Trading Company");

    const auditCountBeforeFailure = (await db.collection("settingsAuditEvents")
      .where("institutionId", "==", institutionA).get()).size;
    const runTransaction = db.runTransaction.bind(db);
    Object.defineProperty(db, "runTransaction", {
      configurable: true,
      value: async () => { throw new Error("simulated settings transaction failure"); },
    });
    let failedWrite: Response;
    try {
      failedWrite = await settings.POST(request(ownerAToken, {
        ...savePayload,
        idempotencyKey: "settings-transaction-failure-001",
        values: { "profile.tradingName": "Must not be persisted" },
      }));
    } finally {
      Object.defineProperty(db, "runTransaction", { configurable: true, value: runTransaction });
    }
    assert.equal(failedWrite!.status, 500);
    const unchangedProfile = await db.collection("institutionSettings").doc(institutionA)
      .collection("sections").doc("profile").get();
    assert.equal((unchangedProfile.get("values") as Record<string, unknown>)["profile.tradingName"], "A Trading Company");
    assert.equal((await db.collection("settingsAuditEvents")
      .where("institutionId", "==", institutionA).get()).size, auditCountBeforeFailure);

    const audits = await db.collection("settingsAuditEvents").where("institutionId", "==", institutionA).limit(20).get();
    assert.ok(audits.size >= 3);
    assert.ok(audits.docs.every((event) => event.get("actorUid") === ownerA.uid
      && event.get("previousState") !== undefined && event.get("newState") !== undefined
      && event.get("reason") && event.get("where")));
  } finally {
    for (const institutionId of [institutionA, institutionB]) {
      const settingsSections = await db.collection("institutionSettings").doc(institutionId).collection("sections").get();
      for (const section of settingsSections.docs) {
        const drafts = await section.ref.collection("drafts").get();
        await Promise.all(drafts.docs.map((draft) => draft.ref.delete()));
        await section.ref.delete();
      }
    }
    const [audits, idempotency] = await Promise.all([
      db.collection("settingsAuditEvents").where("institutionId", "in", [institutionA, institutionB]).get(),
      db.collection("requestIdempotency").where("institutionId", "in", [institutionA, institutionB]).get(),
    ]);
    await Promise.all([...audits.docs, ...idempotency.docs].map((document) => document.ref.delete()));
    for (const account of [ownerA, ownerB, employee]) {
      await Promise.all([
        db.collection("users").doc(account.uid).delete(),
        db.collection("memberships").doc(account.uid).delete(),
        db.collection("effectivePermissions").doc(account.uid).delete(),
      ]);
      await auth.deleteUser(account.uid);
    }
    await Promise.all([institutionA, institutionB].map((institutionId) =>
      db.collection("institutions").doc(institutionId).delete()));
    for (const token of [ownerA.token, ownerB.token, employee.token, ...tokens]) {
      await db.collection("securitySessions").doc(sessionTokenHash(token)).delete();
    }
  }
});
