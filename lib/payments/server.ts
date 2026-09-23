import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { verifyActiveSession } from "@/lib/firebase/server-auth";

export async function requirePaymentOperator() {
  if (!adminAuth || !adminDb) throw new Error("Firebase server is not configured.");
  const token = (await cookies()).get("__session")?.value;
  if (!token) throw new Error("You must be signed in.");
  const decoded = await verifyActiveSession(token);
  const snapshot = await adminDb.collection("users").doc(decoded.uid).get();
  const profile = snapshot.data();
  if (!snapshot.exists || !profile?.institutionId || profile.status !== "active") {
    throw new Error("Your account is not available.");
  }
  return { uid: decoded.uid, profile, db: adminDb };
}
