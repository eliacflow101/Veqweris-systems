import { NextResponse } from "next/server";
import { requirePaymentOperator } from "@/lib/payments/server";
import { listFlutterwaveTransactionRefunds, refundFlutterwaveTransaction } from "@/lib/payments/flutterwave";
import { RefundNotSubmittedError, settlePaymentRefund, processPaymentRefund } from "@/lib/payments/refunds";

export async function POST(request: Request) {
  try {
    const { uid, profile, db } = await requirePaymentOperator(request);
    const body = await request.json() as { action?: string; paymentId?: string; amount?: number; reason?: string; idempotencyKey?: string; refundId?: string; providerReference?: string };
    if (body.action === "reconcile") {
      if (!body.refundId) return NextResponse.json({ error: "refundId is required." }, { status: 400 });
      const refundRef = db.collection("refunds").doc(body.refundId);
      const refundSnapshot = await refundRef.get();
      if (!refundSnapshot.exists || refundSnapshot.get("institutionId") !== profile.institutionId) {
        return NextResponse.json({ error: "Refund not found." }, { status: 404 });
      }
      const refund = refundSnapshot.data()!;
      if (!["PROCESSING", "AMBIGUOUS"].includes(String(refund.status))) {
        return NextResponse.json({ refundId: body.refundId, status: refund.status }, { status: 200 });
      }
      const paymentSnapshot = await db.collection("payments").doc(String(refund.paymentId)).get();
      const providerReference = paymentSnapshot.get("providerReference");
      if (!paymentSnapshot.exists || paymentSnapshot.get("institutionId") !== profile.institutionId || !providerReference) {
        return NextResponse.json({ refundId: body.refundId, status: refund.status, recoveryRequired: true }, { status: 202 });
      }
      const providerRefunds = await listFlutterwaveTransactionRefunds(String(providerReference));
      const priorIds = new Set<string>((refund.providerRefundIdsBefore as string[] | undefined) ?? []);
      const knownReference = body.providerReference ?? refund.providerReference;
      const knownProviderId = knownReference ? String(knownReference) : "";
      let providerRefund = knownReference
        ? providerRefunds.find((item) =>
          String(item.id) === knownProviderId
          && (String(refund.providerReference ?? "") === knownProviderId || !priorIds.has(knownProviderId))
          && Math.round(Number(item.amount) * 100) === Number(refund.amountMinor))
        : undefined;
      if (!providerRefund && !knownReference) {
        const candidates = providerRefunds.filter((item) =>
          item.id
          && !priorIds.has(String(item.id))
          && Number.isFinite(item.amount)
          && Math.round(Number(item.amount) * 100) === Number(refund.amountMinor));
        if (candidates.length === 1) providerRefund = candidates[0];
      }
      if (!providerRefund) {
        return NextResponse.json({ refundId: body.refundId, status: refund.status, recoveryRequired: true }, { status: 202 });
      }
      const providerStatus = String(providerRefund.status ?? "").toLowerCase();
      const resolvedStatus = ["success", "successful", "completed"].includes(providerStatus)
        ? "COMPLETED"
        : ["failed", "rejected", "cancelled"].includes(providerStatus)
          ? "FAILED"
          : "AMBIGUOUS";
      if (resolvedStatus === "AMBIGUOUS") {
        return NextResponse.json({ refundId: body.refundId, status: "AMBIGUOUS" }, { status: 202 });
      }
      const result = await settlePaymentRefund(db, {
        refundId: body.refundId,
        status: resolvedStatus,
        providerReference: String(providerRefund.id),
        failureReason: resolvedStatus === "FAILED" ? `Provider reported ${providerStatus}.` : null,
      });
      return NextResponse.json(result, { status: resolvedStatus === "COMPLETED" ? 200 : 409 });
    }
    if (!body.paymentId || body.amount === undefined || !body.idempotencyKey) {
      return NextResponse.json({ error: "paymentId, amount, and idempotencyKey are required." }, { status: 400 });
    }
    const paymentSnapshot = await db.collection("payments").doc(body.paymentId).get();
    if (!paymentSnapshot.exists || paymentSnapshot.get("institutionId") !== profile.institutionId) {
      return NextResponse.json({ error: "Payment not found." }, { status: 404 });
    }
    const providerReference = paymentSnapshot.get("providerReference");
    if (!providerReference) return NextResponse.json({ error: "Payment has no verified provider reference." }, { status: 409 });
    const result = await processPaymentRefund({
      db,
      institutionId: profile.institutionId,
      actorUid: uid,
      paymentId: body.paymentId,
      amount: body.amount,
      idempotencyKey: body.idempotencyKey,
      reason: body.reason,
    }, async (refundId) => {
      let previousRefunds: Array<{ id?: string | number; status?: string; amount?: number }>;
      try {
        previousRefunds = await listFlutterwaveTransactionRefunds(String(providerReference));
      } catch (error) {
        throw new RefundNotSubmittedError(error instanceof Error ? error.message : "Unable to check existing provider refunds.");
      }
      try {
        await db.collection("refunds").doc(refundId).update({
          providerRefundIdsBefore: previousRefunds.map((refund) => String(refund.id)).filter((id) => id !== "undefined"),
        });
      } catch (error) {
        throw new RefundNotSubmittedError(error instanceof Error ? error.message : "Unable to persist provider reconciliation context.");
      }
      return refundFlutterwaveTransaction(String(providerReference), body.amount);
    });
    const status = result.status === "COMPLETED" ? 200
      : result.status === "FAILED" ? 409 : 202;
    return NextResponse.json({
      refundId: result.refundId,
      status: result.status,
      duplicate: result.duplicate,
      ...(result.status === "AMBIGUOUS" ? { recoveryRequired: true } : {}),
    }, { status });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Unable to request refund.";
    console.error("Unable to request payment refund.", reason);
    const status = message.includes("signed in") || message.includes("token") || message.includes("Session") ? 401
      : message === "Firebase server is not configured." ? 503
        : message === "FORBIDDEN" || message.includes("not available") || message.includes("billing is not enabled") ? 403
          : ["PAYMENT_NOT_FOUND", "REFUND_NOT_FOUND"].includes(message) ? 404
            : ["INVALID_REFUND_AMOUNT", "INVALID_IDEMPOTENCY_KEY"].includes(message) ? 400
              : ["PAYMENT_NOT_REFUNDABLE", "REFUND_BALANCE_EXCEEDED", "REFUND_BALANCE_INVALID", "IDEMPOTENCY_KEY_REUSED"].includes(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
