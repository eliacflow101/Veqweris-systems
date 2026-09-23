import assert from "node:assert/strict";
import {
  buildExternalEvent,
  eventIdempotencyKey,
  eventReferences,
  integrationSignature,
  resolveIntegration,
  verifyIntegrationSignature,
  hashIntegrationKey,
} from "../lib/integrations";

const keyId = "vqi_test";
const secret = "integration-secret";
const credential = {
  keyIdHash: hashIntegrationKey(keyId),
  status: "active" as const,
  integrationId: "integration-1",
  institutionId: "institution-1",
  provider: "hotel",
  scopes: ["hospitality:bookings"],
};
const integration = {
  integrationId: "integration-1",
  institutionId: "institution-1",
  provider: "hotel",
  status: "active" as const,
  scopes: ["hospitality:bookings"],
};

const booking = buildExternalEvent({
  eventId: "booking-1",
  integrationId: "integration-1",
  institutionId: "institution-1",
  provider: "hotel",
  type: "hotel.booking.created",
  payload: { bookingId: "booking-1", room: "101" },
});
const order = buildExternalEvent({
  eventId: "order-1",
  integrationId: "integration-1",
  institutionId: "institution-1",
  provider: "hotel",
  type: "order.created",
  payload: { orderId: "order-1", total: 25 },
});
assert.equal(eventReferences(booking.type, booking.payload).module, "hospitality");
assert.equal(eventReferences(order.type, order.payload).module, "retail");
assert.equal(eventIdempotencyKey("hotel", "integration-1", "booking-1"), booking.idempotencyKey);
assert.equal(eventIdempotencyKey("hotel", "integration-1", "booking-1"), booking.idempotencyKey);

const body = JSON.stringify({ type: "hotel.booking.created", bookingId: "booking-1" });
const signature = integrationSignature(body, secret);
assert.equal(verifyIntegrationSignature(body, signature, secret), true);
assert.equal(verifyIntegrationSignature(body, "00".repeat(32), secret), false);
assert.throws(() => resolveIntegration(credential, integration, "wrong-key", "hospitality:bookings"), /INVALID_INTEGRATION_CREDENTIAL/);
assert.throws(() => resolveIntegration(credential, { ...integration, institutionId: "institution-2" }, keyId, "hospitality:bookings"), /INTEGRATION_SCOPE_MISMATCH/);
assert.throws(() => resolveIntegration(credential, integration, keyId, "retail:orders"), /INTEGRATION_SCOPE_DENIED/);
console.log("integration gateway tests passed");
