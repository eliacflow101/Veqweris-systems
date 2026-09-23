export type NotificationOrigin =
  | "task" | "approval" | "payment" | "planner" | "inventory" | "security"
  | "workflow" | "document" | "admission" | "academic" | "operational";

export type NotificationState = "Created" | "Queued" | "Processing" | "Sent" | "Delivered" | "Failed" | "Retrying" | "Cancelled";
export type NotificationChannel = "in_app" | "email" | "sms" | "push";
export type NotificationSensitivity = "public" | "internal" | "confidential" | "restricted";
export type NotificationUrgency = "low" | "normal" | "high" | "critical";

export interface NotificationEvent {
  eventId: string;
  idempotencyKey?: string;
  institutionId: string;
  origin: NotificationOrigin;
  type: string;
  title: string;
  body: string;
  recipientUid: string;
  module?: string;
  priority?: number;
  sensitivity?: NotificationSensitivity;
  urgency?: NotificationUrgency;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationPreferences {
  inApp?: boolean;
  email?: boolean;
  sms?: boolean;
  push?: boolean;
  disabledOrigins?: NotificationOrigin[];
  minimumUrgency?: NotificationUrgency;
}

export interface InstitutionNotificationPolicy {
  enabledChannels?: NotificationChannel[];
  disabledOrigins?: NotificationOrigin[];
  allowSensitiveEmail?: boolean;
  allowSensitivePush?: boolean;
}

export interface NotificationTypePolicy {
  origin: NotificationOrigin;
  type: string;
  channels?: NotificationChannel[];
  sensitivity?: NotificationSensitivity;
  urgency?: NotificationUrgency;
  important?: boolean;
}

export interface Notification {
  notificationId: string;
  eventId: string;
  idempotencyKey: string;
  institutionId: string;
  recipientUid: string;
  origin: NotificationOrigin;
  type: string;
  module?: string;
  title: string;
  body: string;
  sensitivity: NotificationSensitivity;
  urgency: NotificationUrgency;
  priority: number;
  important: boolean;
  channels: NotificationChannel[];
  state: NotificationState;
  attempts: number;
  read: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationFilter {
  origin?: NotificationOrigin;
  type?: string;
  module?: string;
  important?: boolean;
  unread?: boolean;
  archived?: boolean;
  from?: string;
  to?: string;
}
