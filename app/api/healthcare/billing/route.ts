import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";

export async function POST(request: Request) {
  try {
    if (!adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    const token = await getSessionToken(request);
    if (!token) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const decoded = await verifyActiveSession(token);
    const profile = (await adminDb.collection("users").doc(decoded.uid).get()).data();
    if (!profile?.institutionId || !["Owner", "Admin", "Manager", "Billing", "Clinician", "Reception"].includes(profile.role)) {
      return NextResponse.json({ error: "You are not authorized to create healthcare bills." }, { status: 403 });
    }
    const body = await request.json() as {
      patientId?: string;
      encounterId?: string;
      serviceId?: string;
      description?: string;
      total?: number;
      currency?: string;
    };
    if (!body.patientId || !body.description || !Number.isFinite(body.total) || Number(body.total) <= 0 || !body.currency) {
      return NextResponse.json({ error: "patientId, description, positive total, and currency are required." }, { status: 400 });
    }
    const patient = await adminDb.collection("patientIdentities").doc(body.patientId).get();
    if (!patient.exists || patient.data()?.institutionId !== profile.institutionId) {
      return NextResponse.json({ error: "Patient is unavailable." }, { status: 404 });
    }
    const billRef = adminDb.collection("bills").doc();
    await billRef.set({
      billId: billRef.id,
      institutionId: profile.institutionId,
      customerUid: patient.data()?.userId ?? null,
      customerReference: body.patientId,
      patientId: body.patientId,
      encounterId: body.encounterId ?? null,
      serviceId: body.serviceId ?? null,
      description: body.description.trim(),
      total: Number(body.total),
      currency: body.currency.trim().toUpperCase(),
      status: "OPEN",
      createdBy: decoded.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ billId: billRef.id, status: "OPEN" }, { status: 201 });
  } catch (reason) {
    console.error("Unable to create healthcare bill.", reason);
    return NextResponse.json({ error: "Unable to create healthcare bill." }, { status: 400 });
  }
}
