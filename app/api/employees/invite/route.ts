import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { UserRole } from "@/lib/firebase/models";

const invitedRoles: UserRole[] = ["Admin", "Manager", "Employee"];

type InviteRequest = {
  email?: string;
  fullName?: string;
  role?: UserRole;
  departmentId?: string | null;
};

export async function POST(request: Request) {
  try {
    if (!adminAuth || !adminDb) {
      return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    }

    const sessionToken = (await cookies()).get("__session")?.value;
    if (!sessionToken) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const inviter = await adminAuth.verifyIdToken(sessionToken);
    const inviterSnapshot = await adminDb.collection("users").doc(inviter.uid).get();
    const inviterProfile = inviterSnapshot.data();
    if (!inviterSnapshot.exists || !inviterProfile || !["Owner", "Admin"].includes(inviterProfile.role)) {
      return NextResponse.json({ error: "Only Owners and Admins can invite employees." }, { status: 403 });
    }

    const input = (await request.json()) as InviteRequest;
    const email = input.email?.trim().toLowerCase();
    const fullName = input.fullName?.trim();
    const role = input.role;
    const departmentId = input.departmentId?.trim() || null;

    if (!email || !fullName || !role || !invitedRoles.includes(role)) {
      return NextResponse.json({ error: "Enter a name, email, and a valid invite role." }, { status: 400 });
    }

    if (departmentId) {
      const departmentSnapshot = await adminDb.collection("departments").doc(departmentId).get();
      if (!departmentSnapshot.exists || departmentSnapshot.data()?.institutionId !== inviterProfile.institutionId) {
        return NextResponse.json({ error: "The selected department is not in your institution." }, { status: 400 });
      }
    }

    const temporaryPassword = randomBytes(18).toString("base64url");
    const createdUser = await adminAuth.createUser({ email, password: temporaryPassword, displayName: fullName });
    try {
      await adminDb.collection("users").doc(createdUser.uid).set({
        uid: createdUser.uid,
        institutionId: inviterProfile.institutionId,
        fullName,
        email,
        role,
        departmentId,
        lastActive: null,
        status: "active",
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (reason) {
      await adminAuth.deleteUser(createdUser.uid).catch((cleanupReason) => {
        console.error("Unable to clean up an incomplete employee invite.", cleanupReason);
      });
      throw reason;
    }

    return NextResponse.json({ uid: createdUser.uid, temporaryPassword });
  } catch (reason) {
    const code = typeof reason === "object" && reason !== null && "code" in reason ? String(reason.code) : "";
    if (code === "auth/email-already-exists") {
      return NextResponse.json({ error: "An account already exists for this email." }, { status: 409 });
    }
    console.error("Unable to invite employee.", reason);
    return NextResponse.json({ error: "Unable to invite employee." }, { status: 500 });
  }
}
