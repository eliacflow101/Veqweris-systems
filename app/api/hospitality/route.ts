import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";

const collections = new Set(["hotelRooms", "hotelReservations", "hospitalityOutlets", "hospitalityOrders", "housekeepingTasks", "maintenanceTickets", "retailCatalogItems", "retailSales"]);

async function context(request: Request) {
  if (!adminDb) throw new Error("Firebase server is not configured.");
  const token = await getSessionToken(request);
  if (!token) throw new Error("Authentication required.");
  const decoded = await verifyActiveSession(token);
  const profile = (await adminDb.collection("users").doc(decoded.uid).get()).data();
  if (!profile?.institutionId) throw new Error("Institution profile required.");
  return profile;
}

export async function GET(request: Request) {
  try {
    const profile = await context(request);
    const name = new URL(request.url).searchParams.get("collection") ?? "hotelRooms";
    if (!collections.has(name)) return NextResponse.json({ error: "Unsupported hospitality collection." }, { status: 400 });
    const snapshot = await adminDb!.collection(name).where("institutionId", "==", profile.institutionId).get();
    return NextResponse.json({ records: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load records." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const profile = await context(request);
    const body = await request.json() as { collection?: string; record?: Record<string, unknown> };
    if (!body.collection || !collections.has(body.collection) || !body.record) return NextResponse.json({ error: "collection and record are required." }, { status: 400 });
    const ref = adminDb!.collection(body.collection).doc();
    await ref.set({ ...body.record, institutionId: profile.institutionId, updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save record." }, { status: 400 });
  }
}
