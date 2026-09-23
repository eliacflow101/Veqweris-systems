import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { verifyActiveSession } from "@/lib/firebase/server-auth";

export async function POST(request: Request) {
  try {
    if (!adminAuth || !adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    const token = (await cookies()).get("__session")?.value;
    if (!token) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const actor = await verifyActiveSession(token);
    const actorProfile = (await adminDb.collection("users").doc(actor.uid).get()).data();
    const body = await request.json().catch(() => ({})) as { uid?: string };
    const targetUid = body.uid?.trim() || actor.uid;

    if (targetUid !== actor.uid && !["Owner", "Admin"].includes(actorProfile?.role)) {
      return NextResponse.json({ error: "Only Owners and Admins can revoke another user's sessions." }, { status: 403 });
    }
    const target = await adminDb.collection("users").doc(targetUid).get();
    if (!target.exists || target.data()?.institutionId !== actorProfile?.institutionId) {
      return NextResponse.json({ error: "Target user is outside your institution." }, { status: 403 });
    }

    await adminAuth.revokeRefreshTokens(targetUid);
    const sessions = await adminDb.collection("securitySessions").where("uid", "==", targetUid).where("status", "==", "active").get();
    const batch = adminDb.batch();
    sessions.docs.forEach((session) => batch.update(session.ref, {
      status: "revoked",
      revokedBy: actor.uid,
      revokedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }));
    await batch.commit();
    const eventRef = adminDb.collection("securityEvents").doc();
    await eventRef.set({
      eventId: eventRef.id,
      institutionId: actorProfile?.institutionId,
      uid: actor.uid,
      type: "session_revocation",
      source: "auth.revoke-sessions",
      details: { targetUid },
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ revoked: true, targetUid });
  } catch (reason) {
    console.error("Unable to revoke sessions.", reason);
    return NextResponse.json({ error: "Unable to revoke sessions." }, { status: 401 });
  }
}
