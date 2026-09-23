import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

export async function POST(request: Request) {
  try {
    if (!adminAuth || !adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    const body = await request.json() as { token?: string; institutionId?: string; password?: string };
    const token = body.token?.trim();
    const institutionId = body.institutionId?.trim();
    const password = body.password ?? "";
    if (!token || !institutionId || password.length < 8) {
      return NextResponse.json({ error: "A valid token, institution ID, and password of at least 8 characters are required." }, { status: 400 });
    }
    const tokenRef = adminDb.collection("recoveryRequests").doc(hashToken(token));
    const tokenSnapshot = await tokenRef.get();
    const tokenData = tokenSnapshot.data();
    if (!tokenSnapshot.exists || !tokenData || tokenData.status !== "issued" || tokenData.institutionId !== institutionId) {
      return NextResponse.json({ error: "Recovery token is invalid." }, { status: 400 });
    }
    const expiresAt = tokenData.expiresAt as Timestamp;
    if (!expiresAt || expiresAt.toMillis() <= Date.now()) {
      await tokenRef.update({ status: "expired", updatedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ error: "Recovery token has expired." }, { status: 400 });
    }
    await adminAuth.updateUser(tokenData.uid, { password });
    await adminAuth.revokeRefreshTokens(tokenData.uid);
    const sessions = await adminDb.collection("securitySessions").where("uid", "==", tokenData.uid).where("status", "==", "active").get();
    const batch = adminDb.batch();
    sessions.docs.forEach((session) => batch.update(session.ref, { status: "revoked", revokedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
    batch.update(tokenRef, { status: "consumed", consumedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    await batch.commit();
    const eventRef = adminDb.collection("securityEvents").doc();
    await eventRef.set({
      eventId: eventRef.id,
      institutionId,
      uid: tokenData.uid,
      type: "recovery_completion",
      source: "auth.recovery.complete",
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ recovered: true });
  } catch (reason) {
    console.error("Unable to complete account recovery.", reason);
    return NextResponse.json({ error: "Unable to complete account recovery." }, { status: 400 });
  }
}
