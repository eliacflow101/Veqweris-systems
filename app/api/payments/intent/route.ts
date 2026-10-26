import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { assertIdempotencyKey, createInternalReference } from "@/lib/payments/engine";
import { initializeFlutterwaveCheckout } from "@/lib/payments/flutterwave";
import { requirePaymentOperator } from "@/lib/payments/server";

export async function POST(request: Request) {
  try {
    const { uid, profile, db } = await requirePaymentOperator(request);
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

    const idempotencyId = `${profile.institutionId}_${idempotencyKey}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 140);
    const idempotencyRef = db.collection("paymentIdempotency").doc(idempotencyId);
    const billRef = db.collection("bills").doc(billId);
    const paymentRef = db.collection("payments").doc();
    const internalReference = createInternalReference(profile.institutionId, paymentRef.id);
    const reservation = await db.runTransaction(async (transaction) => {
      const [latestBill, latestIdempotency] = await transaction.getAll(billRef, idempotencyRef);
      const bill = latestBill.data();
      if (!latestBill.exists || !bill || bill.institutionId !== profile.institutionId
        || bill.status === "CANCELLED" || bill.status === "PAID") {
        throw new Error("BILL_UNAVAILABLE");
      }
      if (latestIdempotency.exists) {
        const existing = latestIdempotency.data();
        if (existing?.institutionId !== profile.institutionId || existing?.billId !== billId || typeof existing?.paymentId !== "string") {
          throw new Error("IDEMPOTENCY_CONFLICT");
        }
        return { kind: "existing" as const, paymentId: existing.paymentId };
      }
      if (typeof bill.activePaymentId === "string" && bill.activePaymentId) {
        throw new Error("BILL_PAYMENT_IN_PROGRESS");
      }
      const amount = Number(bill.total);
      const currency = String(bill.currency ?? "").toUpperCase();
      if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) {
        throw new Error("BILL_UNAVAILABLE");
      }
      const payment = {
        paymentId: paymentRef.id,
        institutionId: profile.institutionId,
        billId,
        customerUid: bill.customerUid ?? uid,
        customerReference: bill.customerReference ?? null,
        originalAmount: amount,
        originalCurrency: currency,
        transactionAmount: amount,
        transactionCurrency: currency,
        institutionBaseCurrency: currency,
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
      transaction.set(paymentRef, payment);
      transaction.create(idempotencyRef, {
        idempotencyKey,
        institutionId: profile.institutionId,
        billId,
        paymentId: paymentRef.id,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(billRef, { activePaymentId: paymentRef.id, updatedAt: FieldValue.serverTimestamp() });
      return { kind: "created" as const, payment };
    });

    if (reservation.kind === "existing") {
      const existingPayment = await db.collection("payments").doc(reservation.paymentId).get();
      if (!existingPayment.exists || existingPayment.get("institutionId") !== profile.institutionId
        || existingPayment.get("billId") !== billId) {
        throw new Error("IDEMPOTENCY_CONFLICT");
      }
      if (existingPayment.get("status") === "INITIATED" || existingPayment.get("checkoutInitializationStatus") === "unknown") {
        return NextResponse.json({ error: "Payment initialization is still unresolved. Contact support before retrying." }, { status: 409 });
      }
      if (existingPayment.get("status") === "FAILED") {
        return NextResponse.json({ error: "This payment attempt failed and requires reconciliation before another attempt." }, { status: 409 });
      }
      const status = existingPayment.get("status");
      const checkoutLink = existingPayment.get("checkoutLink");
      if (status === "PENDING" && (typeof checkoutLink !== "string" || !checkoutLink.trim())) {
        return NextResponse.json({ error: "Payment checkout is unavailable and requires reconciliation." }, { status: 409 });
      }
      return NextResponse.json({
        paymentId: reservation.paymentId,
        status,
        checkoutLink: checkoutLink ?? null,
      });
    }
    const payment = reservation.payment;
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
      await paymentRef.update({
        checkoutInitializationStatus: "unknown",
        checkoutInitializationUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.error("Flutterwave checkout initialization outcome is unknown; bill remains reserved for reconciliation.", reason);
      return NextResponse.json({ error: "Payment initialization could not be confirmed. Contact support before retrying." }, { status: 502 });
    }
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Unable to initialize payment.";
    if (message === "BILL_UNAVAILABLE") return NextResponse.json({ error: "Bill is unavailable for payment." }, { status: 404 });
    if (message === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ error: "This idempotency key is already associated with another payment." }, { status: 409 });
    if (message === "BILL_PAYMENT_IN_PROGRESS") return NextResponse.json({ error: "A payment for this bill is already being processed." }, { status: 409 });
    const status = message.includes("signed in") || message.includes("token") || message.includes("Session") ? 401
      : message === "Firebase server is not configured." ? 503
        : message.includes("not available") || message.includes("billing is not enabled") ? 403
          : message.includes("required") ? 400 : 500;
    console.error("Unable to initialize Flutterwave payment.", reason);
    return NextResponse.json({ error: message }, { status });
  }
}
