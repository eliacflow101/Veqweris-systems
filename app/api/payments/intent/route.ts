import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { assertIdempotencyKey, createInternalReference } from "@/lib/payments/engine";
import { initializeFlutterwaveCheckout } from "@/lib/payments/flutterwave";
import { requirePaymentOperator } from "@/lib/payments/server";

export async function POST(request: Request) {
  try {
    const { uid, profile, db } = await requirePaymentOperator();
    const body = await request.json() as {
      billId?: string;
      idempotencyKey?: string;
      customerEmail?: string;
      customerName?: string;
      customerPhone?: string;
      redirectUrl?: string;
    };
    const billId = body.billId?.trim();
    const idempotencyKey = body.idempotencyKey?.trim();
    if (!billId || !idempotencyKey || !body.customerEmail || !body.redirectUrl) {
      return NextResponse.json({ error: "billId, idempotencyKey, customerEmail, and redirectUrl are required." }, { status: 400 });
    }
    assertIdempotencyKey(idempotencyKey);

    const billSnapshot = await db.collection("bills").doc(billId).get();
    const bill = billSnapshot.data();
    if (!billSnapshot.exists || !bill || bill.institutionId !== profile.institutionId || bill.status === "CANCELLED" || bill.status === "PAID") {
      return NextResponse.json({ error: "Bill is unavailable for payment." }, { status: 404 });
    }

    const idempotencyId = `${profile.institutionId}_${idempotencyKey}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 140);
    const idempotencyRef = db.collection("paymentIdempotency").doc(idempotencyId);
    const existing = await idempotencyRef.get();
    if (existing.exists) {
      const existingPaymentId = existing.data()?.paymentId as string | undefined;
      if (existingPaymentId) {
        const payment = await db.collection("payments").doc(existingPaymentId).get();
        return NextResponse.json({ paymentId: existingPaymentId, status: payment.data()?.status, checkoutLink: payment.data()?.checkoutLink ?? null });
      }
    }

    const paymentRef = db.collection("payments").doc();
    const internalReference = createInternalReference(profile.institutionId, paymentRef.id);
    const payment = {
      paymentId: paymentRef.id,
      institutionId: profile.institutionId,
      billId,
      customerUid: bill.customerUid ?? uid,
      customerReference: bill.customerReference ?? null,
      originalAmount: Number(bill.total),
      originalCurrency: String(bill.currency).toUpperCase(),
      transactionAmount: Number(bill.total),
      transactionCurrency: String(bill.currency).toUpperCase(),
      institutionBaseCurrency: String(bill.currency).toUpperCase(),
      provider: "flutterwave" as const,
      providerReference: null,
      internalReference,
      paymentMethod: null,
      status: "INITIATED" as const,
      idempotencyKey,
      metadata: {},
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await db.runTransaction(async (transaction) => {
      const latest = await transaction.get(idempotencyRef);
      if (latest.exists) throw new Error("IDEMPOTENCY_RACE");
      transaction.set(paymentRef, payment);
      transaction.create(idempotencyRef, {
        idempotencyKey,
        institutionId: profile.institutionId,
        paymentId: paymentRef.id,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    try {
      const checkout = await initializeFlutterwaveCheckout({
        tx_ref: internalReference,
        amount: payment.transactionAmount,
        currency: payment.transactionCurrency,
        customer: { email: body.customerEmail, name: body.customerName, phonenumber: body.customerPhone },
        redirect_url: body.redirectUrl,
        meta: { institutionId: profile.institutionId, billId, paymentId: paymentRef.id },
      });
      await paymentRef.update({ status: "PENDING", checkoutLink: checkout.link, updatedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ paymentId: paymentRef.id, internalReference, status: "PENDING", checkoutLink: checkout.link });
    } catch (reason) {
      await paymentRef.update({ status: "FAILED", failureReason: reason instanceof Error ? reason.message : "Provider unavailable", updatedAt: FieldValue.serverTimestamp() });
      throw reason;
    }
  } catch (reason) {
    if (reason instanceof Error && reason.message === "IDEMPOTENCY_RACE") {
      return NextResponse.json({ error: "A payment with this idempotency key is already being processed." }, { status: 409 });
    }
    const message = reason instanceof Error ? reason.message : "Unable to initialize payment.";
    const status = message.includes("signed in") ? 401 : message.includes("required") ? 400 : 500;
    console.error("Unable to initialize Flutterwave payment.", reason);
    return NextResponse.json({ error: message }, { status });
  }
}
