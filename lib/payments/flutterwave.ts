import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export interface FlutterwaveCheckoutInput {
  tx_ref: string;
  amount: number;
  currency: string;
  customer: { email: string; name?: string; phonenumber?: string };
  redirect_url: string;
  meta?: Record<string, string>;
}

export interface FlutterwaveVerification {
  id: string;
  tx_ref: string;
  status: string;
  amount: number;
  currency: string;
  charged_amount?: number;
  app_fee?: number;
  merchant_fee?: number;
  payment_type?: string;
  customer?: { email?: string };
}

const baseUrl = "https://api.flutterwave.com/v3";

function secretKey() {
  const value = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!value) throw new Error("Flutterwave server configuration is missing.");
  return value;
}

async function flutterwaveRequest<T>(path: string, init: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json() as { status?: string; message?: string; data?: T };
  if (!response.ok || body.status !== "success" || body.data === undefined) {
    throw new Error(body.message || "Flutterwave request failed.");
  }
  return body.data;
}

export function createFlutterwaveSignature(rawBody: string, secretHash: string) {
  return createHmac("sha256", secretHash).update(rawBody).digest("hex");
}

export function verifyFlutterwaveSignature(rawBody: string, received: string | null, secretHash = process.env.FLUTTERWAVE_SECRET_HASH) {
  if (!received || !secretHash) return false;
  const expected = secretHash;
  const expectedHmac = createFlutterwaveSignature(rawBody, secretHash);
  const receivedBuffer = Buffer.from(received, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const hmacBuffer = Buffer.from(expectedHmac, "utf8");
  return (expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer))
    || (hmacBuffer.length === receivedBuffer.length && timingSafeEqual(hmacBuffer, receivedBuffer));
}

export function initializeFlutterwaveCheckout(input: FlutterwaveCheckoutInput) {
  return flutterwaveRequest<{ link: string }>("/payments", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      payment_options: process.env.FLUTTERWAVE_PAYMENT_OPTIONS || undefined,
    }),
  });
}

export function verifyFlutterwaveTransaction(transactionId: string) {
  return flutterwaveRequest<FlutterwaveVerification>(`/transactions/${encodeURIComponent(transactionId)}/verify`, { method: "GET" });
}

export function refundFlutterwaveTransaction(transactionId: string, amount?: number) {
  return flutterwaveRequest<{ id?: string; status?: string }>(`/transactions/${encodeURIComponent(transactionId)}/refund`, {
    method: "POST",
    body: JSON.stringify(amount === undefined ? {} : { amount }),
  });
}
