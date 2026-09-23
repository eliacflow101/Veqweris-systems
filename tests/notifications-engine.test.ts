import assert from "node:assert/strict";
import { createNotification, deliverNotification, filterNotifications, transitionNotification, type NotificationEvent } from "../lib/notifications";

const event: NotificationEvent = { eventId: "evt-1", institutionId: "inst-a", recipientUid: "user-a", origin: "security", type: "account.locked", title: "Account locked", body: "Contact an administrator.", urgency: "critical", createdAt: "2026-01-01T00:00:00.000Z" };
const first = createNotification(event);
assert.equal(createNotification(event).notificationId, first.notificationId);
assert.equal(first.channels.includes("in_app"), true);
assert.equal(filterNotifications([first], { unread: true }).length, 1);
void (async () => {
  const failed = await deliverNotification(first, [{ channel: "in_app", deliver: async () => { throw new Error("offline"); } }], event.createdAt);
  assert.equal(failed.state, "Failed");
  const retry = transitionNotification(failed, "Retrying", event.createdAt);
  assert.equal(transitionNotification(retry, "Queued", event.createdAt).state, "Queued");
  const delivered = await deliverNotification(first, [{ channel: "in_app", deliver: async () => undefined }], event.createdAt);
  assert.equal(delivered.state, "Delivered");
  console.log("notification engine tests passed");
})();
