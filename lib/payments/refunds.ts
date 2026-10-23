import { createHash, randomUUID } from "node:crypto";
import { AggregateField, FieldValue, type Firestore } from "firebase-admin/firestore";
import type { RefundStatus } from "@/lib/payments/models";

type RefundInput = {
  db: Firestore;
  institutionId: string;
  actorUid: string;
  paymentId: string;
  amount: number;
  idempotencyKey: string;
  reason?: string | null;
};

type RefundResult = {
  refundId: string;
  status: RefundStatus;
  duplicate: boolean;
};

export class RefundNotSubmittedError extends Error {}

function amountToMinor(amount: number) {
  const minor = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - minor) > 0.000001) {
    throw new Error("INVALID_REFUND_AMOUNT");
  }
  return minor;
}

function storedAmountToMinor(amount: number) {
  const minor = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount < 0 || Math.abs(amount * 100 - minor) > 0.000001) {
    throw new Error("REFUND_TOTAL_INVALID");
  }
  return minor;
}

function idempotencyDocumentId(institutionId: string, paymentId: string, key: string) {
  return createHash("sha256").update(`${institutionId}:${paymentId}:${key}`).digest("hex");
}

function eventDocumentId(refundId: string, action: string) {
  return `refund_${refundId}_${action}`;
}

async function refundTotals(db: Firestore, paymentId: string) {
  const refunds = db.collection("refunds").where("paymentId", "==", paymentId);
  const [completed, reserved] = await Promise.all([
    refunds.where("status", "in", ["COMPLETED", "PARTIAL"]).aggregate({ amount: AggregateField.sum("amount") }).get(),
    refunds.where("status", "in", ["REQUESTED", "PROCESSING", "AMBIGUOUS"]).aggregate({ amount: AggregateField.sum("amount") }).get(),
  ]);
  return {
    refundedMinor: storedAmountToMinor(Number(completed.data().amount ?? 0)),
    reservedMinor: storedAmountToMinor(Number(reserved.data().amount ?? 0)),
  };
}

export async function processPaymentRefund(
  input: RefundInput,
  providerRefund: (refundId: string) => Promise<{ id?: string | number; status?: string }>,
): Promise<RefundResult> {
  const amountMinor = amountToMinor(input.amount);
  const key = input.idempotencyKey.trim();
  if (key.length < 8 || key.length > 128) throw new Error("INVALID_IDEMPOTENCY_KEY");

  const { db } = input;
  const paymentRef = db.collection("payments").doc(input.paymentId);
  const idempotencyRef = db.collection("refundRequests").doc(idempotencyDocumentId(input.institutionId, input.paymentId, key));
  const refundId = randomUUID();
  const refundRef = db.collection("refunds").doc(refundId);
  const totals = await refundTotals(db, input.paymentId);

  const reservation = await db.runTransaction(async (transaction) => {
    const [paymentSnapshot, idempotencySnapshot] = await transaction.getAll(paymentRef, idempotencyRef);
    if (idempotencySnapshot.exists) {
      const previous = idempotencySnapshot.data()!;
      if (previous.amountMinor !== amountMinor) throw new Error("IDEMPOTENCY_KEY_REUSED");
      const previousRefund = await transaction.get(db.collection("refunds").doc(String(previous.refundId)));
      if (!previousRefund.exists) throw new Error("REFUND_RECORD_MISSING");
      return {
        refundId: String(previous.refundId),
        status: previousRefund.get("status") as RefundStatus,
        duplicate: true,
      };
    }
    if (!paymentSnapshot.exists) throw new Error("PAYMENT_NOT_FOUND");
    const payment = paymentSnapshot.data()!;
    if (payment.institutionId !== input.institutionId) throw new Error("PAYMENT_NOT_FOUND");
    if (!["VERIFIED", "FINALIZED", "PARTIALLY_REFUNDED"].includes(String(payment.status))) {
      throw new Error("PAYMENT_NOT_REFUNDABLE");
    }
    const paymentAmountMinor = amountToMinor(Number(payment.transactionAmount));
    const refundedMinor = Number.isSafeInteger(payment.refundedAmountMinor)
      ? Number(payment.refundedAmountMinor)
      : Math.max(totals.refundedMinor, storedAmountToMinor(Number(payment.refundedAmount ?? 0)));
    const reservedMinor = Number.isSafeInteger(payment.refundReservedMinor)
      ? Number(payment.refundReservedMinor)
      : totals.reservedMinor;
    if (refundedMinor < 0 || reservedMinor < 0 || refundedMinor + reservedMinor > paymentAmountMinor) {
      throw new Error("REFUND_BALANCE_INVALID");
    }
    if (amountMinor > paymentAmountMinor - refundedMinor - reservedMinor) {
      throw new Error("REFUND_BALANCE_EXCEEDED");
    }

    transaction.update(paymentRef, {
      refundedAmountMinor: refundedMinor,
      refundReservedMinor: reservedMinor + amountMinor,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(refundRef, {
      refundId,
      paymentId: input.paymentId,
      institutionId: input.institutionId,
      amount: input.amount,
      amountMinor,
      currency: payment.transactionCurrency,
      reason: input.reason ?? null,
      status: "REQUESTED",
      providerReference: null,
      createdBy: input.actorUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(idempotencyRef, {
      refundId,
      paymentId: input.paymentId,
      institutionId: input.institutionId,
      amountMinor,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(db.collection("securityEvents").doc(eventDocumentId(refundId, "requested")), {
      eventId: eventDocumentId(refundId, "requested"),
      institutionId: input.institutionId,
      uid: input.actorUid,
      type: "sensitive_action",
      source: "payments.refund.requested",
      details: { paymentId: input.paymentId, refundId, amountMinor },
      createdAt: FieldValue.serverTimestamp(),
    });
    return { refundId, status: "REQUESTED" as RefundStatus, duplicate: false };
  });

  if (reservation.status !== "REQUESTED") return reservation;

  await setRefundProcessing(db, reservation.refundId);
  let providerResult: { id?: string | number; status?: string };
  try {
    providerResult = await providerRefund(reservation.refundId);
  } catch (error) {
    if (error instanceof RefundNotSubmittedError) {
      return await settlePaymentRefund(db, {
        refundId: reservation.refundId,
        status: "FAILED",
        failureReason: error.message,
      });
    }
    console.error("Provider refund outcome is ambiguous; refundable balance remains reserved.", error);
    return await settlePaymentRefund(db, {
      refundId: reservation.refundId,
      status: "AMBIGUOUS",
      failureReason: "Provider outcome could not be confirmed. Reconciliation is required.",
    });
  }
  const status = String(providerResult.status ?? "").toLowerCase();
  const settledStatus = ["success", "successful", "completed"].includes(status)
    ? "COMPLETED"
    : ["failed", "rejected", "cancelled"].includes(status)
      ? "FAILED"
      : "AMBIGUOUS";
  try {
    return await settlePaymentRefund(db, {
      refundId: reservation.refundId,
      status: settledStatus,
      providerReference: providerResult.id === undefined ? null : String(providerResult.id),
      failureReason: settledStatus === "FAILED" ? `Provider reported ${status}.` : null,
    });
  } catch (settlementError) {
    console.error("Provider refund response could not be durably settled; reconciliation is required.", settlementError);
    return await settlePaymentRefund(db, {
      refundId: reservation.refundId,
      status: "AMBIGUOUS",
      providerReference: providerResult.id === undefined ? null : String(providerResult.id),
      failureReason: "Provider outcome was received but could not be durably settled.",
    });
  }
}

async function setRefundProcessing(db: Firestore, refundId: string) {
  const refundRef = db.collection("refunds").doc(refundId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(refundRef);
    if (!snapshot.exists || snapshot.get("status") !== "REQUESTED") return;
    transaction.update(refundRef, { status: "PROCESSING", updatedAt: FieldValue.serverTimestamp() });
    const eventId = eventDocumentId(refundId, "processing");
    transaction.create(db.collection("securityEvents").doc(eventId), {
      eventId,
      institutionId: snapshot.get("institutionId"),
      uid: snapshot.get("createdBy"),
      type: "sensitive_action",
      source: "payments.refund.processing",
      details: { paymentId: snapshot.get("paymentId"), refundId },
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function settlePaymentRefund(
  db: Firestore,
  input: { refundId: string; status: "COMPLETED" | "FAILED" | "AMBIGUOUS"; providerReference?: string | null; failureReason?: string | null },
): Promise<RefundResult> {
  const refundRef = db.collection("refunds").doc(input.refundId);
  return db.runTransaction(async (transaction) => {
    const refundSnapshot = await transaction.get(refundRef);
    if (!refundSnapshot.exists) throw new Error("REFUND_NOT_FOUND");
    const refund = refundSnapshot.data()!;
    const paymentRef = db.collection("payments").doc(String(refund.paymentId));
    const paymentSnapshot = await transaction.get(paymentRef);
    if (!paymentSnapshot.exists || paymentSnapshot.get("institutionId") !== refund.institutionId) {
      throw new Error("PAYMENT_NOT_FOUND");
    }
    const currentStatus = refund.status as RefundStatus;
    if (currentStatus === "COMPLETED" || currentStatus === "FAILED") {
      return { refundId: input.refundId, status: currentStatus, duplicate: true };
    }
    if (!["PROCESSING", "AMBIGUOUS"].includes(currentStatus)) throw new Error("INVALID_REFUND_STATE");

    const payment = paymentSnapshot.data()!;
    const amountMinor = Number(refund.amountMinor);
    const reservedMinor = Number(payment.refundReservedMinor ?? amountMinor);
    if (reservedMinor < amountMinor) throw new Error("REFUND_RESERVATION_INVALID");
    const refundedMinor = Number(payment.refundedAmountMinor ?? 0);
    const nextRefundedMinor = input.status === "COMPLETED" ? refundedMinor + amountMinor : refundedMinor;
    const nextReservedMinor = input.status === "AMBIGUOUS" ? reservedMinor : reservedMinor - amountMinor;
    const totalMinor = amountToMinor(Number(payment.transactionAmount));
    const eventAction = input.status.toLowerCase();
    const eventId = eventDocumentId(input.refundId, eventAction);

    if (input.status !== "AMBIGUOUS") {
      transaction.update(paymentRef, {
        refundedAmountMinor: nextRefundedMinor,
        refundReservedMinor: nextReservedMinor,
        ...(input.status === "COMPLETED" ? {
          status: nextRefundedMinor >= totalMinor ? "REFUNDED" : "PARTIALLY_REFUNDED",
          refundedAmount: nextRefundedMinor / 100,
        } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(refundRef, {
      status: input.status,
      ...(input.providerReference ? { providerReference: input.providerReference } : {}),
      ...(input.failureReason ? { failureReason: input.failureReason } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(db.collection("securityEvents").doc(eventId), {
      eventId,
      institutionId: refund.institutionId,
      uid: refund.createdBy,
      type: "sensitive_action",
      source: `payments.refund.${eventAction}`,
      details: { paymentId: refund.paymentId, refundId: input.refundId, amountMinor, failureReason: input.failureReason ?? null },
      createdAt: FieldValue.serverTimestamp(),
    });
    return { refundId: input.refundId, status: input.status, duplicate: false };
  });
}
