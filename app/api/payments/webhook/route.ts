import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { assertPaymentAmounts, transitionPayment } from "@/lib/payments/engine";
import { verifyFlutterwaveSignature, verifyFlutterwaveTransaction } from "@/lib/payments/flutterwave";
import { adminDb } from "@/lib/firebase/admin";

type WebhookPayload = {
  event?: string;
  data?: { id?: string | number; tx_ref?: string; status?: string; meta?: { paymentId?: string; institutionId?: string } };
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyFlutterwaveSignature(rawBody, request.headers.get("verif-hash"))) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  if (!adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
  const db = adminDb;

  try {
    const payload = JSON.parse(rawBody) as WebhookPayload;
    const providerId = payload.data?.id ? String(payload.data.id) : "";
    const txRef = payload.data?.tx_ref;
    if (!providerId || !txRef || payload.event !== "charge.completed") {
      return NextResponse.json({ error: "Unsupported or invalid webhook event." }, { status: 400 });
    }

    const eventRef = db.collection("paymentWebhookEvents").doc(providerId);
    const priorEvent = await eventRef.get();
    if (priorEvent.exists) return NextResponse.json({ received: true, duplicate: true });

    const paymentSnapshot = await db.collection("payments").where("internalReference", "==", txRef).limit(1).get();
    if (paymentSnapshot.empty) {
      await eventRef.create({ provider: "flutterwave", providerEventId: providerId, status: "rejected", reason: "Unknown internal reference", receivedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ error: "Unknown payment reference." }, { status: 404 });
    }
    const paymentDoc = paymentSnapshot.docs[0];
    const payment = paymentDoc.data();
    const verified = await verifyFlutterwaveTransaction(providerId);
    if (verified.tx_ref !== payment.internalReference) throw new Error("Provider reference does not match internal reference.");
    assertPaymentAmounts({
      expectedAmount: payment.transactionAmount,
      expectedCurrency: payment.transactionCurrency,
      providerAmount: Number(verified.amount),
      providerCurrency: verified.currency,
    });
    if (verified.status !== "successful") throw new Error("Provider did not report a successful transaction.");

    let verificationPayment = { ...payment, status: payment.status } as Parameters<typeof transitionPayment>[0];
    if (verificationPayment.status === "INITIATED") verificationPayment = transitionPayment(verificationPayment, "PENDING");
    if (verificationPayment.status === "PENDING") verificationPayment = transitionPayment(verificationPayment, "PROVIDER_PROCESSING");
    if (verificationPayment.status === "PROVIDER_PROCESSING") verificationPayment = transitionPayment(verificationPayment, "PROVIDER_CONFIRMATION");
    if (verificationPayment.status === "PROVIDER_CONFIRMATION") verificationPayment = transitionPayment(verificationPayment, "SERVER_VERIFICATION");
    if (verificationPayment.status === "SERVER_VERIFICATION") verificationPayment = transitionPayment(verificationPayment, "VERIFIED");
    const verifiedPayment = verificationPayment;
    const finalizedPayment = transitionPayment(transitionPayment(verifiedPayment, "VERIFIED"), "FINALIZED");
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(paymentDoc.ref);
      const currentData = current.data();
      if (!current.exists || currentData?.status === "FINALIZED") {
        transaction.create(eventRef, { provider: "flutterwave", providerEventId: providerId, status: "duplicate", receivedAt: FieldValue.serverTimestamp() });
        return;
      }
      transaction.update(paymentDoc.ref, {
        ...finalizedPayment,
        providerReference: providerId,
        paymentMethod: verified.payment_type ?? null,
        providerFees: verified.app_fee ?? verified.merchant_fee ?? null,
        updatedAt: FieldValue.serverTimestamp(),
        verifiedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(db.collection("bills").doc(payment.billId), { status: "PAID", updatedAt: FieldValue.serverTimestamp() });
      const receiptRef = db.collection("receipts").doc();
      transaction.create(receiptRef, {
        receiptId: receiptRef.id,
        paymentId: payment.paymentId,
        billId: payment.billId,
        institutionId: payment.institutionId,
        customerReference: payment.customerReference ?? null,
        amount: payment.transactionAmount,
        currency: payment.transactionCurrency,
        paymentMethod: verified.payment_type ?? null,
        provider: "flutterwave",
        reference: payment.internalReference,
        status: "PAID",
        issuedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(eventRef, { provider: "flutterwave", providerEventId: providerId, status: "processed", paymentId: payment.paymentId, receivedAt: FieldValue.serverTimestamp() });
    });
    return NextResponse.json({ received: true });
  } catch (reason) {
    console.error("Unable to process Flutterwave webhook.", reason);
    return NextResponse.json({ error: "Webhook verification failed." }, { status: 400 });
  }
}
