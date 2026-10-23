import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

const projectId = "demo-veqweris-refunds";
process.env.FIREBASE_PROJECT_ID = projectId;
process.env.FIREBASE_CLIENT_EMAIL = "refund-tests@demo-veqweris-refunds.iam.gserviceaccount.com";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";

let db: import("firebase-admin/firestore").Firestore;
let processPaymentRefund: typeof import("../lib/payments/refunds").processPaymentRefund;
let settlePaymentRefund: typeof import("../lib/payments/refunds").settlePaymentRefund;

before(async () => {
  const admin = await import("../lib/firebase/admin");
  assert.ok(admin.adminDb, "Firestore emulator configuration is required.");
  db = admin.adminDb;
  ({ processPaymentRefund, settlePaymentRefund } = await import("../lib/payments/refunds"));
});

after(async () => {
  const { getApps, deleteApp } = await import("firebase-admin/app");
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

function paymentId() {
  return `refund-test-${randomUUID()}`;
}

async function createPayment(id: string, amount = 100) {
  await db.collection("payments").doc(id).set({
    paymentId: id,
    institutionId: "refund-test-institution",
    transactionAmount: amount,
    transactionCurrency: "USD",
    providerReference: `provider-${id}`,
    status: "FINALIZED",
  });
}

function input(id: string, amount: number, idempotencyKey: string) {
  return {
    db,
    institutionId: "refund-test-institution",
    actorUid: "refund-test-operator",
    paymentId: id,
    amount,
    idempotencyKey,
  };
}

async function waitForProviderCall(readCalls: () => number) {
  for (let attempt = 0; attempt < 100 && readCalls() === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(readCalls() > 0, "provider call started");
}

test("concurrent reservations cannot exceed the refundable balance", async () => {
  const id = paymentId();
  await createPayment(id);
  let resolveProvider!: (value: { id: string; status: string }) => void;
  let calls = 0;
  let firstError: unknown;
  const first = processPaymentRefund(input(id, 60, "refund-concurrent-1"), () => {
    calls += 1;
    return new Promise((resolve) => { resolveProvider = resolve; });
  }).catch((error: unknown) => { firstError = error; throw error; });
  await waitForProviderCall(() => calls || (firstError ? 1 : 0));
  if (firstError) throw firstError;
  await assert.rejects(
    processPaymentRefund(input(id, 60, "refund-concurrent-2"), async () => {
      calls += 1;
      return { id: "unexpected", status: "success" };
    }),
    /REFUND_BALANCE_EXCEEDED/,
  );
  assert.equal(calls, 1, "the over-balance operation never reaches the provider");
  resolveProvider({ id: "provider-refund-1", status: "success" });
  assert.equal((await first).status, "COMPLETED");
  const payment = await db.collection("payments").doc(id).get();
  assert.equal(payment.get("refundedAmountMinor"), 6000);
  assert.equal(payment.get("refundReservedMinor"), 0);
});

test("duplicate requests reuse their idempotent refund and never call the provider twice", async () => {
  const id = paymentId();
  await createPayment(id);
  let resolveProvider!: (value: { id: string; status: string }) => void;
  let calls = 0;
  const first = processPaymentRefund(input(id, 25, "refund-duplicate-1"), () => {
    calls += 1;
    return new Promise((resolve) => { resolveProvider = resolve; });
  });
  await waitForProviderCall(() => calls);
  const duplicate = await processPaymentRefund(input(id, 25, "refund-duplicate-1"), async () => {
    calls += 1;
    return { id: "unexpected", status: "success" };
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.status, "PROCESSING");
  assert.equal(calls, 1);
  resolveProvider({ id: "provider-refund-2", status: "completed" });
  assert.equal((await first).status, "COMPLETED");
  const replay = await processPaymentRefund(input(id, 25, "refund-duplicate-1"), async () => {
    calls += 1;
    return { id: "unexpected", status: "success" };
  });
  assert.equal(replay.status, "COMPLETED");
  assert.equal(replay.duplicate, true);
  assert.equal(calls, 1);
  await assert.rejects(processPaymentRefund(input(id, 26, "refund-duplicate-1"), async () => ({ status: "success" })), /IDEMPOTENCY_KEY_REUSED/);
});

test("provider-declared failure releases the reservation and audits the outcome", async () => {
  const id = paymentId();
  await createPayment(id);
  const result = await processPaymentRefund(input(id, 40, "refund-provider-failure"), async () => ({
    id: "provider-refund-failed",
    status: "failed",
  }));
  assert.equal(result.status, "FAILED");
  const payment = await db.collection("payments").doc(id).get();
  assert.equal(payment.get("refundReservedMinor"), 0);
  assert.equal(payment.get("refundedAmountMinor"), 0);
  const events = await db.collection("securityEvents").where("source", "==", "payments.refund.failed").get();
  assert.ok(events.docs.some((event) => event.get("details.paymentId") === id));
});

test("uncertain provider outcomes retain capacity until verified reconciliation", async () => {
  const id = paymentId();
  await createPayment(id);
  const result = await processPaymentRefund(input(id, 70, "refund-recovery-1"), async () => ({
    id: "provider-refund-pending",
    status: "pending",
  }));
  assert.equal(result.status, "AMBIGUOUS");
  let payment = await db.collection("payments").doc(id).get();
  assert.equal(payment.get("refundReservedMinor"), 7000);
  const reconciled = await settlePaymentRefund(db, {
    refundId: result.refundId,
    status: "COMPLETED",
    providerReference: "provider-refund-pending",
  });
  assert.equal(reconciled.status, "COMPLETED");
  payment = await db.collection("payments").doc(id).get();
  assert.equal(payment.get("refundReservedMinor"), 0);
  assert.equal(payment.get("refundedAmountMinor"), 7000);
  assert.equal(payment.get("status"), "PARTIALLY_REFUNDED");
  const event = await db.collection("securityEvents").doc(`refund_${result.refundId}_completed`).get();
  assert.equal(event.exists, true);
});
