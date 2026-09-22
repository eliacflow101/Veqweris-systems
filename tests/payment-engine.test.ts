import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertIdempotencyKey, assertPaymentAmounts, canTransitionPayment, reconcileFinancialEvents } from "../lib/payments";

describe("provider-neutral payment engine", () => {
  it("allows the verified finalization path and rejects terminal rewrites", () => {
    assert.equal(canTransitionPayment("SERVER_VERIFICATION", "VERIFIED"), true);
    assert.equal(canTransitionPayment("FINALIZED", "VERIFIED"), false);
    assert.equal(canTransitionPayment("FAILED", "VERIFIED"), false);
  });

  it("enforces amount and currency equality", () => {
    assert.doesNotThrow(() => assertPaymentAmounts({ expectedAmount: 100, expectedCurrency: "KES", providerAmount: 100, providerCurrency: "KES" }));
    assert.throws(() => assertPaymentAmounts({ expectedAmount: 100, expectedCurrency: "KES", providerAmount: 99, providerCurrency: "KES" }));
    assert.throws(() => assertPaymentAmounts({ expectedAmount: 100, expectedCurrency: "KES", providerAmount: 100, providerCurrency: "USD" }));
  });

  it("requires a bounded idempotency key", () => {
    assert.doesNotThrow(() => assertIdempotencyKey("checkout-2026-abc"));
    assert.throws(() => assertIdempotencyKey("short"));
  });

  it("creates neutral reconciliation exceptions without accusing staff", () => {
    const result = reconcileFinancialEvents({
      reconciliationId: "rec-1",
      institutionId: "inst-1",
      expectedEventId: "expected-1",
      expectedAmount: 100,
      expectedCurrency: "KES",
      actualEventId: "actual-1",
      actualAmount: 50,
      actualCurrency: "KES",
    });
    assert.equal(result.status, "EXCEPTION");
    assert.equal(result.exceptionType, "PARTIAL_PAYMENT");
    assert.match(result.message ?? "", /Potential Financial Leakage/);
  });
});
