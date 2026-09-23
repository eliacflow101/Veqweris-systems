import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { createInventoryMovement } from "@/lib/inventory-engine";

const allowedRoles = ["Owner", "Admin", "Manager", "Operator", "Service Worker"];

function serialize(value: unknown): unknown {
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return value;
}

export async function GET(request: Request) {
  try {
    if (!adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    const token = await getSessionToken(request);
    if (!token) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const decoded = await verifyActiveSession(token);
    const profile = (await adminDb.collection("users").doc(decoded.uid).get()).data();
    if (!profile?.institutionId) return NextResponse.json({ error: "Institution profile required." }, { status: 403 });
    const itemId = new URL(request.url).searchParams.get("itemId");
    let query = adminDb.collection("inventoryMovements").where("institutionId", "==", profile.institutionId);
    if (itemId) query = query.where("itemId", "==", itemId) as typeof query;
    const snapshot = await query.get();
    const movements = snapshot.docs.map((doc) => Object.fromEntries(Object.entries({ ...doc.data(), movementId: doc.data().movementId || doc.id }).map(([key, value]) => [key, serialize(value)])));
    movements.sort((a, b) => String(b.timestamp || b.createdAt || "").localeCompare(String(a.timestamp || a.createdAt || "")));
    return NextResponse.json({ movements });
  } catch (reason) {
    console.error("Unable to load inventory movements.", reason);
    return NextResponse.json({ error: "Unable to load inventory movements." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    if (!adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    const token = await getSessionToken(request);
    if (!token) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const decoded = await verifyActiveSession(token);
    const profile = (await adminDb.collection("users").doc(decoded.uid).get()).data();
    if (!profile || !allowedRoles.includes(profile.role)) return NextResponse.json({ error: "You are not authorized to manage inventory." }, { status: 403 });

    const body = await request.json() as {
      movementId?: string; itemId?: string; type?: string; quantity?: number; adjustmentDirection?: "increase" | "decrease"; destinationLocationId?: string; reason?: string; sourceEvent?: string; approvalRequired?: boolean;
    };
    const movementId = body.movementId?.trim();
    const itemId = body.itemId?.trim();
    const quantity = Number(body.quantity);
    const supportedTypes = ["Receiving", "Issue", "Transfer", "Adjustment", "Consumption", "Return", "Release", "Waste", "Expiry"];
    if (!movementId || !itemId || !body.type || !supportedTypes.includes(body.type) || !Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "movementId, itemId, type, and a positive quantity are required." }, { status: 400 });
    }
    const itemRef = adminDb.collection("inventoryItems").doc(itemId);
    const movementRef = adminDb.collection("inventoryMovements").doc(movementId);
    const institutionId = profile.institutionId;
    const result = await adminDb.runTransaction(async (transaction) => {
      const [itemSnapshot, priorMovement] = await Promise.all([transaction.get(itemRef), transaction.get(movementRef)]);
      if (priorMovement.exists) return { duplicate: true, movement: priorMovement.data() };
      const item = itemSnapshot.data();
      if (!itemSnapshot.exists || !item || item.institutionId !== institutionId) throw new Error("Inventory item not found.");
      if (body.type === "Transfer" && !body.destinationLocationId?.trim()) throw new Error("A destination location is required for transfers.");
      const sign = body.type === "Receiving" || body.type === "Return" || body.type === "Release" || (body.type === "Adjustment" && body.adjustmentDirection === "increase") ? 1 : body.type === "Transfer" ? 0 : -1;
      const previousQuantity = Number(item.currentQuantity);
      const newQuantity = previousQuantity + sign * quantity;
      if (newQuantity < 0) throw new Error("Insufficient stock for this movement.");
      const movement = createInventoryMovement({
        movementId,
        itemId,
        institutionId,
        type: body.type as never,
        previousQuantity,
        movementQuantity: sign * quantity,
        newQuantity,
        actorUid: decoded.uid,
        sourceEvent: body.sourceEvent?.trim() || "inventory.manual",
        reason: body.reason?.trim() || "Operational inventory movement",
        approvalRequired: Boolean(body.approvalRequired),
      });
      transaction.update(itemRef, {
        currentQuantity: newQuantity,
        availableQuantity: Math.max(newQuantity - Number(item.reservedQuantity || 0), 0),
        ...(body.type === "Transfer" && body.destinationLocationId?.trim() ? { locationId: body.destinationLocationId.trim() } : {}),
        lastMovementAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(movementRef, { ...movement, createdAt: FieldValue.serverTimestamp() });
      return { duplicate: false, movement };
    });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Unable to record inventory movement.";
    console.error("Unable to record inventory movement.", reason);
    return NextResponse.json({ error: message }, { status: message.includes("authorized") ? 403 : 400 });
  }
}
