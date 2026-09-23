import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
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
    const body = await request.json() as { action?: "register" | "revoke"; terminalId?: string; label?: string; scope?: string };
    const terminalId = body.terminalId?.trim();
    if (!terminalId) return NextResponse.json({ error: "terminalId is required." }, { status: 400 });
    const terminalRef = adminDb.collection("terminalProfiles").doc(terminalId);

    if (body.action === "revoke") {
      if (!["Owner", "Admin"].includes(profile?.role)) return NextResponse.json({ error: "Only Owners and Admins can revoke terminals." }, { status: 403 });
      const terminal = await terminalRef.get();
      if (!terminal.exists || terminal.data()?.institutionId !== profile?.institutionId) return NextResponse.json({ error: "Terminal not found." }, { status: 404 });
      await terminalRef.update({ status: "revoked", revokedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ terminalId, status: "revoked" });
    }

    if (!["Owner", "Admin", "Manager"].includes(profile?.role)) return NextResponse.json({ error: "Terminal registration is restricted." }, { status: 403 });
    const terminal = await terminalRef.get();
    if (terminal.exists && terminal.data()?.institutionId !== profile?.institutionId) return NextResponse.json({ error: "Terminal belongs to another institution." }, { status: 403 });
    await terminalRef.set({
      terminalId,
      institutionId: profile?.institutionId,
      label: body.label?.trim() || terminal.data()?.label || terminalId,
      scope: body.scope?.trim() || terminal.data()?.scope || "restricted",
      status: "active",
      registeredBy: terminal.data()?.registeredBy || decoded.uid,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: terminal.data()?.createdAt || FieldValue.serverTimestamp(),
    }, { merge: true });
    const sessionId = randomBytes(18).toString("base64url");
    await adminDb.collection("terminalSessions").doc(sessionId).set({
      sessionId,
      terminalId,
      institutionId: profile?.institutionId,
      uid: decoded.uid,
      status: "active",
      expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 60 * 1000),
      autoLockAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ sessionId, terminalId, expiresInSeconds: 2 * 60 * 60 });
  } catch (reason) {
    console.error("Unable to manage terminal session.", reason);
    return NextResponse.json({ error: "Unable to manage terminal session." }, { status: 401 });
  }
}
