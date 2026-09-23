export type IntegrationProvider = "hotel" | "order" | (string & {});
export type IntegrationStatus = "active" | "disabled" | "revoked";
export type IntegrationEventStatus = "received" | "processed" | "duplicate" | "rejected" | "failed";

/** Metadata is safe to expose to workspace users. Credentials are never stored here. */
export interface IntegrationRecord {
  integrationId: string;
  institutionId: string;
  provider: IntegrationProvider;
  name: string;
  status: IntegrationStatus;
  scopes: string[];
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
  lastEventAt?: unknown;
}

export interface IntegrationCredential {
  integrationId: string;
  institutionId: string;
  provider: IntegrationProvider;
  /** A one-way hash of the credential id; the raw id is only returned at creation. */
  keyIdHash: string;
  /** HMAC secret is kept in this server-only collection. */
  secret: string;
  status: IntegrationStatus;
  scopes: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface ExternalEvent {
  eventId: string;
  idempotencyKey: string;
  integrationId: string;
  institutionId: string;
  provider: IntegrationProvider;
  type: "hotel.booking.created" | "order.created";
  payload: Record<string, unknown>;
  signatureValid: boolean;
  status: IntegrationEventStatus;
  internalEventId?: string;
  workflowId?: string;
  taskId?: string;
  notificationId?: string;
  errorCode?: string;
  receivedAt: unknown;
  processedAt?: unknown;
}

export interface IntegrationFailure {
  exceptionId: string;
  institutionId: string | null;
  integrationId?: string;
  eventId?: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  createdAt: unknown;
  status: "open" | "resolved";
}

