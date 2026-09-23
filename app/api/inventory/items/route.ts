import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";

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
    const snapshot = await adminDb.collection("inventoryItems").where("institutionId", "==", profile.institutionId).get();
    const items = snapshot.docs.map((doc) => {
      const data = doc.data();
      return Object.fromEntries(Object.entries({ ...data, id: data.id || doc.id, itemId: data.itemId || doc.id }).map(([key, value]) => [key, serialize(value)]));
    });
    return NextResponse.json({ items });
  } catch (reason) {
    console.error("Unable to load inventory items.", reason);
    return NextResponse.json({ error: "Unable to load inventory items." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    if (!adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    const token = await getSessionToken(request);
    if (!token) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const decoded = await verifyActiveSession(token);
    const profile = (await adminDb.collection("users").doc(decoded.uid).get()).data();
    if (!profile || !["Owner", "Admin", "Manager"].includes(profile.role)) return NextResponse.json({ error: "Inventory setup is restricted." }, { status: 403 });
    const body = await request.json() as { itemId?: string; name?: string; sku?: string; category?: string; unit?: string; minimumLevel?: number; safetyLevel?: number; locationId?: string };
    if (!body.name?.trim() || !body.sku?.trim() || !body.unit?.trim() || !body.locationId?.trim()) {
      return NextResponse.json({ error: "name, sku, unit, and locationId are required." }, { status: 400 });
    }
    const ref = body.itemId ? adminDb.collection("inventoryItems").doc(body.itemId) : adminDb.collection("inventoryItems").doc();
    const existing = await ref.get();
    if (existing.exists && existing.data()?.institutionId !== profile.institutionId) return NextResponse.json({ error: "Inventory item belongs to another institution." }, { status: 403 });
    await ref.set({
      itemId: ref.id,
      id: ref.id,
      institutionId: profile.institutionId,
      name: body.name.trim(),
      sku: body.sku.trim(),
      category: body.category?.trim() || "general",
      unit: body.unit.trim(),
      currentQuantity: existing.data()?.currentQuantity ?? 0,
      minimumLevel: Number(body.minimumLevel ?? 0),
      safetyLevel: Number(body.safetyLevel ?? 0),
      reservedQuantity: existing.data()?.reservedQuantity ?? 0,
      availableQuantity: existing.data()?.availableQuantity ?? 0,
      locationId: body.locationId.trim(),
      tracked: true,
      status: existing.data()?.status ?? "Awaiting Confirmation",
      createdAt: existing.data()?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return NextResponse.json({ itemId: ref.id }, { status: existing.exists ? 200 : 201 });
  } catch (reason) {
    console.error("Unable to save inventory item.", reason);
    return NextResponse.json({ error: "Unable to save inventory item." }, { status: 400 });
  }
}
