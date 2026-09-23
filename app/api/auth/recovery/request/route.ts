import { randomBytes, createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { recoveryDelivery } from "@/lib/auth/recovery-delivery";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;
const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

export async function POST(request: Request) {
  try {
    if (!adminAuth || !adminDb) return NextResponse.json({ message: "If the account exists, recovery instructions will be issued." });
    const body = await request.json() as { email?: string; institutionId?: string };
    const email = body.email?.trim().toLowerCase();
    const institutionId = body.institutionId?.trim();
    if (!email || !institutionId) return NextResponse.json({ error: "Email and institution ID are required." }, { status: 400 });

    const now = Date.now();
    const windowStart = Timestamp.fromMillis(now - WINDOW_MS);
    const recent = await adminDb.collection("recoveryRequests")
      .where("email", "==", email)
      .where("createdAt", ">=", windowStart)
      .get();
    if (recent.size >= MAX_REQUESTS) return NextResponse.json({ message: "If the account exists, recovery instructions will be issued." });

    const users = await adminDb.collection("users").where("email", "==", email).where("institutionId", "==", institutionId).limit(1).get();
    const auditRef = adminDb.collection("securityEvents").doc();
    await auditRef.set({
      eventId: auditRef.id,
      institutionId,
      uid: users.empty ? null : users.docs[0].id,
      type: "recovery_request",
      source: "auth.recovery.request",
      details: { matched: !users.empty },
      createdAt: FieldValue.serverTimestamp(),
    });
    if (users.empty) return NextResponse.json({ message: "If the account exists, recovery instructions will be issued." });

    const rawToken = randomBytes(32).toString("base64url");
    const tokenRef = adminDb.collection("recoveryRequests").doc(hashToken(rawToken));
    await tokenRef.create({
      tokenHash: tokenRef.id,
      uid: users.docs[0].id,
      email,
      institutionId,
      status: "issued",
      attempts: 0,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(now + 15 * 60 * 1000),
    });
    const expiresAt = new Date(now + 15 * 60 * 1000);
    await recoveryDelivery.deliver({ email, institutionId, token: rawToken, expiresAt });
    if (process.env.NODE_ENV !== "production" && process.env.RECOVERY_EXPOSE_TOKEN === "true") {
      return NextResponse.json({ message: "Recovery token issued for development verification.", token: rawToken });
    }
    return NextResponse.json({ message: "If the account exists, recovery instructions will be issued." });
  } catch (reason) {
    console.error("Unable to issue account recovery token.", reason);
    return NextResponse.json({ error: "Unable to process recovery request." }, { status: 500 });
  }
}
