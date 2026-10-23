import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { institutionHasModuleEntitlement } from "@/lib/platform/tenant-entitlements";
import { withInstitutionCapacity } from "@/lib/platform/capacity";
import { createNotification, filterNotifications, markNotification, type NotificationEvent, type NotificationFilter } from "@/lib/notifications";

async function auth(request: Request) {
  if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
  const token = await getSessionToken(request);
  if (!token) throw new Error("UNAUTHENTICATED");
  const decoded = await verifyActiveSession(token);
  const profile = (await adminDb.collection("users").doc(decoded.uid).get()).data();
  if (!profile?.institutionId || profile.status !== "active") throw new Error("FORBIDDEN");
  if (!await institutionHasModuleEntitlement(profile.institutionId, "notifications")) throw new Error("FORBIDDEN");
  return { uid: decoded.uid, profile };
}
function error(reason: unknown) {
  const code = reason instanceof Error ? reason.message : "";
  const status = code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403
    : code.startsWith("PLAN_LIMIT_EXCEEDED") ? 409 : code === "SERVICE_UNAVAILABLE" ? 503 : 400;
  return NextResponse.json({ error: status === 409 ? "The institution has reached its monthly notification plan limit."
    : status === 401 ? "Authentication required." : status === 403 ? "Notification access is unavailable." : "Unable to process notifications." }, { status });
}
export async function GET(request: Request) {
  try {
    const { uid, profile } = await auth(request);
    const params = new URL(request.url).searchParams;
    const snapshot = await adminDb!.collection("notifications").where("institutionId", "==", profile.institutionId).where("recipientUid", "==", uid).limit(200).get();
    const filter: NotificationFilter = { origin: params.get("origin") as NotificationFilter["origin"] ?? undefined, type: params.get("type") ?? undefined, module: params.get("module") ?? undefined, unread: params.has("unread") ? params.get("unread") === "true" : undefined, important: params.has("important") ? params.get("important") === "true" : undefined, archived: params.has("archived") ? params.get("archived") === "true" : undefined, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined };
    return NextResponse.json({ notifications: filterNotifications(snapshot.docs.map((doc) => doc.data() as ReturnType<typeof createNotification>), filter) });
  } catch (reason) { return error(reason); }
}
export async function POST(request: Request) {
  try {
    const { uid, profile } = await auth(request);
    const body = await request.json() as Partial<NotificationEvent> & { action?: "read" | "important" | "archive"; notificationId?: string };
    if (body.action && body.notificationId) {
      const ref = adminDb!.collection("notifications").doc(body.notificationId);
      const existing = (await ref.get()).data();
      if (!existing || existing.institutionId !== profile.institutionId || existing.recipientUid !== uid) return NextResponse.json({ error: "Notification not found." }, { status: 404 });
      const updated = markNotification(existing as ReturnType<typeof createNotification>, body.action === "read" ? { read: true } : body.action === "important" ? { important: !existing.important } : { archived: true }, new Date().toISOString());
      await ref.set({ ...updated, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return NextResponse.json({ notification: updated });
    }
    if (!body.eventId || !body.institutionId || body.institutionId !== profile.institutionId || body.recipientUid !== uid || !body.origin || !body.type || !body.title || !body.body || !body.createdAt) return NextResponse.json({ error: "Invalid institution-scoped notification event." }, { status: 400 });
    const event = body as NotificationEvent;
    const notification = createNotification(event);
    const ref = adminDb!.collection("notifications").doc(notification.notificationId);
    const result = await withInstitutionCapacity({
      db: adminDb!,
      institutionId: profile.institutionId,
      limit: "maxMonthlyNotifications",
      amount: 1,
      idempotencyRef: ref,
      duplicate: (existing) => ({ notification: existing.data(), duplicate: true }),
      write: (transaction) => {
        transaction.create(ref, { ...notification, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        return { notification, duplicate: false };
      },
    });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (reason) { return error(reason); }
}
