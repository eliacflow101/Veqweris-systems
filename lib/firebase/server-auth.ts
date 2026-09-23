import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth, adminDb } from "./admin";

export function sessionTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getSessionToken(request?: Request) {
  const authorization = request?.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice("Bearer ".length);
  return (await cookies()).get("__session")?.value ?? null;
}

export async function verifyActiveSession(token: string): Promise<DecodedIdToken> {
  if (!adminAuth || !adminDb) throw new Error("Firebase server is not configured.");
  const decoded = await adminAuth.verifyIdToken(token, true);
  const session = await adminDb.collection("securitySessions").doc(sessionTokenHash(token)).get();
  if (!session.exists) throw new Error("Session is not registered.");

  const sessionData = session.data();
  if (sessionData?.uid !== decoded.uid || sessionData?.status !== "active") {
    throw new Error("Session has been revoked.");
  }
  const expiresAt = sessionData.expiresAt;
  if (expiresAt instanceof Timestamp && expiresAt.toMillis() <= Date.now()) {
    await session.ref.update({ status: "expired", updatedAt: FieldValue.serverTimestamp() });
    throw new Error("Session has expired.");
  }
  return decoded;
}

export async function registerSession(token: string, decoded: DecodedIdToken, maxAgeSeconds: number) {
  if (!adminDb) throw new Error("Firebase server is not configured.");
  const sessionId = sessionTokenHash(token);
  const profile = await adminDb.collection("users").doc(decoded.uid).get();
  await adminDb.collection("securitySessions").doc(sessionId).set({
    sessionId,
    uid: decoded.uid,
    institutionId: profile.data()?.institutionId ?? null,
    issuedAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + maxAgeSeconds * 1000),
    status: "active",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return sessionId;
}

export async function verifyTerminalSession(
  sessionId: string,
  decoded: DecodedIdToken,
  institutionId: string,
) {
  if (!adminDb) throw new Error("Firebase server is not configured.");
  const sessionRef = adminDb.collection("terminalSessions").doc(sessionId);
  const sessionSnapshot = await sessionRef.get();
  const session = sessionSnapshot.data();
  if (!sessionSnapshot.exists || !session || session.uid !== decoded.uid || session.institutionId !== institutionId || session.status !== "active") {
    throw new Error("Terminal session is invalid.");
  }
  const expiresAt = session.expiresAt;
  if (!(expiresAt instanceof Timestamp) || expiresAt.toMillis() <= Date.now()) {
    await sessionRef.update({ status: "expired", updatedAt: FieldValue.serverTimestamp() });
    throw new Error("Terminal session has expired.");
  }
  const terminalSnapshot = await adminDb.collection("terminalProfiles").doc(session.terminalId).get();
  const terminal = terminalSnapshot.data();
  if (!terminalSnapshot.exists || !terminal || terminal.institutionId !== institutionId || terminal.status !== "active") {
    throw new Error("Terminal is unavailable.");
  }
  const autoLockAt = session.autoLockAt;
  if (autoLockAt instanceof Timestamp && autoLockAt.toMillis() <= Date.now()) {
    throw new Error("Terminal workspace is locked.");
  }
  return { sessionId, terminalId: session.terminalId, institutionId };
}
