import type { PaymentRecord, PaymentStatus } from "./models";

const transitions: Record<PaymentStatus, PaymentStatus[]> = {
  INITIATED: ["PENDING", "FAILED", "CANCELLED"],
  PENDING: ["PROVIDER_PROCESSING", "FAILED", "CANCELLED"],
  PROVIDER_PROCESSING: ["PROVIDER_CONFIRMATION", "FAILED", "CANCELLED"],
  PROVIDER_CONFIRMATION: ["SERVER_VERIFICATION", "FAILED"],
  SERVER_VERIFICATION: ["VERIFIED", "FAILED", "DISPUTED"],
  VERIFIED: ["FINALIZED", "REFUNDED", "PARTIALLY_REFUNDED", "REVERSED", "DISPUTED"],
  FINALIZED: ["REFUNDED", "PARTIALLY_REFUNDED", "REVERSED", "DISPUTED"],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
  PARTIALLY_REFUNDED: ["REFUNDED"],
  REVERSED: [],
  DISPUTED: ["VERIFIED", "REVERSED"],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus) {
  return transitions[from].includes(to);
}

export function transitionPayment(payment: PaymentRecord, status: PaymentStatus, now: unknown = new Date().toISOString()): PaymentRecord {
  if (!canTransitionPayment(payment.status, status)) {
    throw new Error(`Invalid payment transition from ${payment.status} to ${status}.`);
  }
  return {
    ...payment,
    status,
    updatedAt: now,
    ...(status === "VERIFIED" ? { verifiedAt: now } : {}),
  };
}

export function createInternalReference(institutionId: string, paymentId: string) {
  return `VEQ-${institutionId.replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase()}-${paymentId}`;
}

export function assertPaymentAmounts(input: {
  expectedAmount: number;
  expectedCurrency: string;
  providerAmount: number;
  providerCurrency: string;
}) {
  if (input.providerAmount !== input.expectedAmount) throw new Error("Provider amount does not match the bill.");
  if (input.providerCurrency.toUpperCase() !== input.expectedCurrency.toUpperCase()) {
    throw new Error("Provider currency does not match the bill.");
  }
}

export function assertIdempotencyKey(value: string) {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new Error("A valid idempotency key is required.");
}
