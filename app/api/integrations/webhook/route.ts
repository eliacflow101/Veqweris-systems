import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { buildExternalEvent, eventReferences, externalEventType, hashIntegrationKey, resolveIntegration, verifyIntegrationSignature, type IntegrationCredential, type IntegrationRecord } from "@/lib/integrations";

function exception(code: string, message: string, institutionId: string | null, extra: Record<string, unknown> = {}) {
  return { exceptionId: createHash("sha256").update(`${code}:${Date.now()}:${Math.random()}`).digest("hex"), institutionId, code, message, ...extra, status: "open", createdAt: FieldValue.serverTimestamp() };
}

export async function POST(request: Request) {
  if (!adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
  const rawBody = await request.text();
  const keyId = request.headers.get("x-integration-key") ?? "";
  const signature = request.headers.get("x-integration-signature") ?? request.headers.get("x-signature");
  const externalEventId = request.headers.get("x-event-id") ?? "";
  if (!keyId || !signature || !externalEventId) return NextResponse.json({ error: "Integration credentials and event id are required." }, { status: 401 });
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(rawBody) as Record<string, unknown>; } catch {
    await adminDb.collection("integrationExceptions").add(exception("INVALID_PAYLOAD", "Webhook payload is not valid JSON.", null));
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  let resolvedInstitutionId: string | null = null;
  try {
    const credentialSnapshot = await adminDb.collection("integrationCredentials").where("keyIdHash", "==", hashIntegrationKey(keyId)).limit(1).get();
    if (credentialSnapshot.empty) throw new Error("INVALID_INTEGRATION_CREDENTIAL");
    const credential = credentialSnapshot.docs[0].data() as IntegrationCredential;
    if (!verifyIntegrationSignature(rawBody, signature, credential.secret)) throw new Error("INVALID_SIGNATURE");
    const integrationSnapshot = await adminDb.collection("integrations").doc(credential.integrationId).get();
    if (!integrationSnapshot.exists) throw new Error("INVALID_INTEGRATION_CREDENTIAL");
    const integration = integrationSnapshot.data() as IntegrationRecord;
    const type = externalEventType(parsed.type);
    const scope = type === "hotel.booking.created" ? "hospitality:bookings" : "retail:orders";
    const resolved = resolveIntegration(credential, integration, keyId, scope);
    resolvedInstitutionId = resolved.institutionId;
    const event = buildExternalEvent({ eventId: externalEventId, integrationId: resolved.integrationId, institutionId: resolved.institutionId, provider: resolved.provider, type, payload: parsed });
    const eventRef = adminDb.collection("externalEvents").doc(event.idempotencyKey);
    const existing = await eventRef.get();
    if (existing.exists) return NextResponse.json({ received: true, duplicate: true, eventId: event.idempotencyKey });
    const references = eventReferences(type, parsed);
    const ownerSnapshot = await adminDb.collection("users").where("institutionId", "==", resolved.institutionId).where("role", "in", ["Owner", "Admin"]).limit(1).get();
    const recipientUid = ownerSnapshot.empty ? null : ownerSnapshot.docs[0].id;
    const internalEventRef = adminDb.collection("events").doc();
    const workflowRef = adminDb.collection("workflows").doc();
    const taskRef = adminDb.collection("tasks").doc();
    const notificationRef = recipientUid ? adminDb.collection("notifications").doc() : null;
    await adminDb.runTransaction(async (tx) => {
      const current = await tx.get(eventRef);
      if (current.exists) return;
      tx.create(eventRef, { ...event, internalEventId: internalEventRef.id, workflowId: workflowRef.id, taskId: taskRef.id, notificationId: notificationRef?.id ?? null, status: "processed", processedAt: FieldValue.serverTimestamp() });
      tx.create(internalEventRef, { eventId: internalEventRef.id, institutionId: resolved.institutionId, type: `integration.${type}`, source: "external-integration", externalEventId: event.eventId, createdAt: FieldValue.serverTimestamp() });
      tx.create(workflowRef, { workflowId: workflowRef.id, institutionId: resolved.institutionId, type: `integration.${type}`, status: "pending", sourceEventId: internalEventRef.id, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      tx.create(taskRef, { taskId: taskRef.id, institutionId: resolved.institutionId, title: references.taskTitle, description: references.title, assignedTo: recipientUid ?? "", assignedBy: "integration-gateway", priority: "high", status: "todo", sourceEventId: internalEventRef.id, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      if (notificationRef && recipientUid) tx.create(notificationRef, { notificationId: notificationRef.id, eventId: internalEventRef.id, idempotencyKey: event.idempotencyKey, institutionId: resolved.institutionId, recipientUid, origin: "operational", type: "external_integration", title: references.title, body: references.taskTitle, state: "Created", read: false, archived: false, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      tx.update(integrationSnapshot.ref, { lastEventAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      tx.create(adminDb!.collection("auditEvents").doc(), { institutionId: resolved.institutionId, action: "integration.event.processed", actor: "external-integration", eventId: event.eventId, createdAt: FieldValue.serverTimestamp() });
    });
    return NextResponse.json({ received: true, duplicate: false, eventId: event.idempotencyKey }, { status: 202 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INTEGRATION_FAILURE";
    const status = code === "INVALID_SIGNATURE" ? 401 : code === "INVALID_INTEGRATION_CREDENTIAL" ? 401 : code === "INTEGRATION_SCOPE_DENIED" || code === "INTEGRATION_SCOPE_MISMATCH" ? 403 : 400;
    await adminDb.collection("integrationExceptions").add(exception(code, "External integration event was rejected.", resolvedInstitutionId, { eventId: externalEventId || null }));
    return NextResponse.json({ error: "External integration request failed." }, { status });
  }
}
