import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requirePaymentOperator } from "@/lib/payments/server";
import { refundFlutterwaveTransaction } from "@/lib/payments/flutterwave";

export async function POST(request: Request) {
  try {
    const { uid, profile, db } = await requirePaymentOperator();
    const body = await request.json() as { paymentId?: string; amount?: number; reason?: string };
    if (!body.paymentId || !body.amount || body.amount <= 0) {
      return NextResponse.json({ error: "paymentId and a positive refund amount are required." }, { status: 400 });
    }
    const paymentRef = db.collection("payments").doc(body.paymentId);
    const paymentSnapshot = await paymentRef.get();
    const payment = paymentSnapshot.data();
    if (!paymentSnapshot.exists || !payment || payment.institutionId !== profile.institutionId) {
      return NextResponse.json({ error: "Payment not found." }, { status: 404 });
    }
    if (!["VERIFIED", "FINALIZED", "PARTIALLY_REFUNDED"].includes(payment.status)) {
      return NextResponse.json({ error: "Only verified payments can be refunded." }, { status: 409 });
    }
    if (body.amount > Number(payment.transactionAmount)) {
      return NextResponse.json({ error: "Refund amount cannot exceed the payment amount." }, { status: 400 });
    }
    const refundRef = db.collection("refunds").doc();
    await refundRef.set({
      refundId: refundRef.id,
      paymentId: payment.paymentId,
      institutionId: payment.institutionId,
      amount: body.amount,
      currency: payment.transactionCurrency,
      reason: body.reason ?? null,
      status: "REQUESTED",
      providerReference: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (payment.providerReference) {
      await refundRef.update({ status: "PROCESSING", updatedAt: FieldValue.serverTimestamp() });
      try {
        const providerRefund = await refundFlutterwaveTransaction(String(payment.providerReference), body.amount);
        await refundRef.update({
          status: "COMPLETED",
          providerReference: providerRefund.id ?? payment.providerReference,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await paymentRef.update({
          status: body.amount === Number(payment.transactionAmount) ? "REFUNDED" : "PARTIALLY_REFUNDED",
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (reason) {
        await refundRef.update({ status: "FAILED", failureReason: reason instanceof Error ? reason.message : "Provider refund failed", updatedAt: FieldValue.serverTimestamp() });
        throw reason;
      }
    }
    await db.collection("securityEvents").add({
      eventId: refundRef.id,
      institutionId: profile.institutionId,
      uid,
      type: "sensitive_action",
      source: "payments.refund",
      details: { paymentId: payment.paymentId, amount: body.amount },
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ refundId: refundRef.id, status: "REQUESTED" }, { status: 202 });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Unable to request refund.";
    console.error("Unable to request payment refund.", reason);
    return NextResponse.json({ error: message }, { status: message.includes("signed in") ? 401 : 500 });
  }
}
