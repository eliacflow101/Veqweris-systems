import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ExternalEvent, IntegrationCredential, IntegrationRecord, IntegrationProvider } from "./models";

export function hashIntegrationKey(keyId: string) {
  return createHash("sha256").update(keyId).digest("hex");
}

export function integrationSignature(rawBody: string, secret: string) {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyIntegrationSignature(rawBody: string, signature: string | null | undefined, secret: string) {
  if (!signature) return false;
  const supplied = signature.replace(/^sha256=/i, "").trim().toLowerCase();
  const expected = integrationSignature(rawBody, secret);
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}

export function eventIdempotencyKey(provider: IntegrationProvider, integrationId: string, externalEventId: string) {
  return createHash("sha256").update(`${provider}:${integrationId}:${externalEventId}`).digest("hex");
}

/** Public names used by adapters and tests; keep the cryptographic primitive in one place. */
export const signIntegrationPayload = integrationSignature;
export const validateIntegrationSignature = verifyIntegrationSignature;
export const deterministicEventId = eventIdempotencyKey;
export const validateIntegrationScope = resolveIntegration;

export function resolveIntegration(
  credential: Pick<IntegrationCredential, "keyIdHash" | "status" | "integrationId" | "institutionId" | "provider" | "scopes">,
  integration: Pick<IntegrationRecord, "integrationId" | "institutionId" | "provider" | "status" | "scopes">,
  keyId: string,
  requiredScope: string,
) {
  if (credential.keyIdHash !== hashIntegrationKey(keyId)) throw new Error("INVALID_INTEGRATION_CREDENTIAL");
  if (credential.status !== "active" || integration.status !== "active") throw new Error("INTEGRATION_DISABLED");
  if (credential.integrationId !== integration.integrationId || credential.institutionId !== integration.institutionId) throw new Error("INTEGRATION_SCOPE_MISMATCH");
  if (credential.provider !== integration.provider || !credential.scopes.includes(requiredScope) || !integration.scopes.includes(requiredScope)) {
    throw new Error("INTEGRATION_SCOPE_DENIED");
  }
  return { integrationId: integration.integrationId, institutionId: integration.institutionId, provider: integration.provider };
}

export function externalEventType(value: unknown): ExternalEvent["type"] {
  if (value === "hotel.booking.created" || value === "order.created") return value;
  throw new Error("UNSUPPORTED_INTEGRATION_EVENT");
}

export function eventReferences(type: ExternalEvent["type"], payload: Record<string, unknown>) {
  if (type === "hotel.booking.created") {
    return { module: "hospitality", title: "External hotel booking", taskTitle: `Review booking ${String(payload.bookingId ?? "external")}` };
  }
  return { module: "retail", title: "External order received", taskTitle: `Fulfil order ${String(payload.orderId ?? "external")}` };
}

export function buildExternalEvent(input: {
  eventId: string;
  integrationId: string;
  institutionId: string;
  provider: IntegrationProvider;
  type: ExternalEvent["type"];
  payload: Record<string, unknown>;
  receivedAt?: unknown;
}): ExternalEvent {
  return {
    ...input,
    idempotencyKey: eventIdempotencyKey(input.provider, input.integrationId, input.eventId),
    signatureValid: true,
    status: "received",
    receivedAt: input.receivedAt ?? new Date().toISOString(),
  };
}

export function processExternalEvent(input: Parameters<typeof buildExternalEvent>[0]) {
  const event = buildExternalEvent(input);
  const references = eventReferences(event.type, event.payload);
  return {
    event,
    internalEvent: { type: `integration.${event.type}`, institutionId: event.institutionId, source: "external-integration", externalEventId: event.eventId },
    workflow: { type: `integration.${event.type}`, institutionId: event.institutionId, sourceEventId: event.idempotencyKey },
    task: { institutionId: event.institutionId, title: references.taskTitle, description: references.title },
    notification: { institutionId: event.institutionId, type: "external_integration", title: references.title, idempotencyKey: event.idempotencyKey },
  };
}
