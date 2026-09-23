import { createHash } from "node:crypto";
import type {
  InstitutionNotificationPolicy, Notification, NotificationChannel, NotificationEvent,
  NotificationPreferences, NotificationTypePolicy, NotificationUrgency, NotificationFilter,
} from "./models";

const urgencyRank: Record<NotificationUrgency, number> = { low: 0, normal: 1, high: 2, critical: 3 };
const defaultChannels: NotificationChannel[] = ["in_app"];

export function notificationId(event: Pick<NotificationEvent, "eventId" | "idempotencyKey" | "recipientUid">) {
  return createHash("sha256").update(`${event.idempotencyKey ?? event.eventId}:${event.recipientUid}`).digest("hex").slice(0, 32);
}

export function decideNotificationChannels(
  event: NotificationEvent,
  preferences: NotificationPreferences = {},
  institutionPolicy: InstitutionNotificationPolicy = {},
  typePolicy?: NotificationTypePolicy,
): NotificationChannel[] {
  const urgency = event.urgency ?? typePolicy?.urgency ?? "normal";
  const criticalSecurity = event.origin === "security" && urgency === "critical";
  const min = preferences.minimumUrgency ?? "low";
  if (!criticalSecurity && urgencyRank[urgency] < urgencyRank[min]) return [];
  if (!criticalSecurity && preferences.disabledOrigins?.includes(event.origin)) return [];
  if (!criticalSecurity && institutionPolicy.disabledOrigins?.includes(event.origin)) return [];
  const configured = typePolicy?.channels ?? institutionPolicy.enabledChannels ?? defaultChannels;
  const selected = configured.filter((channel) => {
    if (channel === "in_app") return preferences.inApp !== false;
    if (channel === "email") return preferences.email === true && (event.sensitivity ?? typePolicy?.sensitivity) !== "restricted" || (preferences.email === true && institutionPolicy.allowSensitiveEmail === true);
    if (channel === "push") return preferences.push === true && (event.sensitivity ?? typePolicy?.sensitivity) !== "restricted" || (preferences.push === true && institutionPolicy.allowSensitivePush === true);
    return preferences.sms === true;
  });
  return criticalSecurity ? Array.from(new Set(["in_app", ...selected])) : selected;
}

export function createNotification(
  event: NotificationEvent,
  options: { preferences?: NotificationPreferences; institutionPolicy?: InstitutionNotificationPolicy; typePolicy?: NotificationTypePolicy } = {},
): Notification {
  const sensitivity = event.sensitivity ?? options.typePolicy?.sensitivity ?? "internal";
  const urgency = event.urgency ?? options.typePolicy?.urgency ?? "normal";
  const idempotencyKey = event.idempotencyKey ?? event.eventId;
  return {
    notificationId: notificationId(event), eventId: event.eventId, idempotencyKey,
    institutionId: event.institutionId, recipientUid: event.recipientUid, origin: event.origin,
    type: event.type, module: event.module, title: event.title, body: event.body, sensitivity, urgency,
    priority: event.priority ?? urgencyRank[urgency], important: options.typePolicy?.important ?? (urgency === "critical" || urgency === "high"),
    channels: decideNotificationChannels(event, options.preferences, options.institutionPolicy, options.typePolicy),
    state: "Created", attempts: 0, read: false, archived: false,
    createdAt: event.createdAt, updatedAt: event.createdAt, metadata: event.metadata,
  };
}

export function transitionNotification(notification: Notification, state: Notification["state"], now: string, error?: string): Notification {
  const allowed: Record<Notification["state"], Notification["state"][]> = {
    Created: ["Queued", "Cancelled"], Queued: ["Processing", "Cancelled"], Processing: ["Sent", "Failed", "Retrying"],
    Sent: ["Delivered", "Failed"], Delivered: [], Failed: ["Retrying", "Cancelled"], Retrying: ["Queued", "Cancelled"], Cancelled: [],
  };
  if (!allowed[notification.state].includes(state)) throw new Error(`Invalid notification transition: ${notification.state} -> ${state}`);
  return { ...notification, state, attempts: state === "Processing" ? notification.attempts + 1 : notification.attempts, updatedAt: now, ...(error ? { metadata: { ...notification.metadata, deliveryError: error } } : {}) };
}

export function filterNotifications(notifications: Notification[], filter: NotificationFilter): Notification[] {
  return notifications.filter((item) =>
    (!filter.origin || item.origin === filter.origin) && (!filter.type || item.type === filter.type)
    && (!filter.module || item.module === filter.module) && (filter.important === undefined || item.important === filter.important)
    && (filter.unread === undefined || item.read !== filter.unread) && (filter.archived === undefined || item.archived === filter.archived)
    && (!filter.from || item.createdAt >= filter.from) && (!filter.to || item.createdAt <= filter.to));
}

export function markNotification(notification: Notification, change: { read?: boolean; important?: boolean; archived?: boolean }, now: string) {
  return { ...notification, ...change, updatedAt: now };
}

export interface NotificationAdapter { readonly channel: NotificationChannel; deliver(notification: Notification): Promise<void>; }
export async function deliverNotification(notification: Notification, adapters: NotificationAdapter[], now = new Date().toISOString()) {
  if (notification.channels.length === 0) return transitionNotification(notification, "Cancelled", now);
  let current = transitionNotification(notification, "Queued", now);
  current = transitionNotification(current, "Processing", now);
  let failure: string | undefined;
  for (const adapter of adapters.filter((item) => current.channels.includes(item.channel))) {
    try { await adapter.deliver(current); } catch (error) { failure = error instanceof Error ? error.message : "Delivery failed"; }
  }
  // Adapters are an asynchronous boundary: a provider failure is recorded, not thrown.
  return failure ? transitionNotification(current, "Failed", now, failure) : transitionNotification(transitionNotification(current, "Sent", now), "Delivered", now);
}
