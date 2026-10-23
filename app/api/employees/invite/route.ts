import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { UserRole } from "@/lib/firebase/models";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { withInstitutionCapacity } from "@/lib/platform/capacity";
import { requireInstitutionModuleEntitlement } from "@/lib/platform/tenant-entitlements";

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

    const sessionToken = await getSessionToken(request);
    if (!sessionToken) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const inviter = await verifyActiveSession(sessionToken);
    const inviterSnapshot = await adminDb.collection("users").doc(inviter.uid).get();
    const inviterProfile = inviterSnapshot.data();
    if (!inviterSnapshot.exists || !inviterProfile || inviterProfile.status !== "active" || !["Owner", "Admin"].includes(inviterProfile.role)) {
      return NextResponse.json({ error: "Only Owners and Admins can invite employees." }, { status: 403 });
    }
    if (!inviterProfile.institutionId) return NextResponse.json({ error: "Institution profile required." }, { status: 403 });
    await requireInstitutionModuleEntitlement(inviterProfile.institutionId, "employees");

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
      const userRef = adminDb.collection("users").doc(createdUser.uid);
      await withInstitutionCapacity({
        db: adminDb,
        institutionId: inviterProfile.institutionId,
        limit: "maxUsers",
        amount: 1,
        write: (transaction) => transaction.create(userRef, {
          uid: createdUser.uid,
          institutionId: inviterProfile.institutionId,
          fullName,
          email,
          role,
          departmentId,
          lastActive: null,
          status: "active",
          createdAt: FieldValue.serverTimestamp(),
        }),
      });
    } catch (reason) {
      try {
        await adminAuth.deleteUser(createdUser.uid);
      } catch (cleanupReason) {
        console.error("Unable to clean up an incomplete employee invite.", cleanupReason);
      }
      throw reason;
    }

    return NextResponse.json({ uid: createdUser.uid, temporaryPassword });
  } catch (reason) {
    const code = typeof reason === "object" && reason !== null && "code" in reason ? String(reason.code) : "";
    if (code === "auth/email-already-exists") {
      return NextResponse.json({ error: "An account already exists for this email." }, { status: 409 });
    }
    if (reason instanceof Error && reason.message.startsWith("PLAN_LIMIT_EXCEEDED")) {
      return NextResponse.json({ error: "The institution has reached its user plan limit." }, { status: 409 });
    }
    if (reason instanceof Error && reason.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Institution employee administration is unavailable." }, { status: 403 });
    }
    console.error("Unable to invite employee.", reason);
    return NextResponse.json({ error: "Unable to invite employee." }, { status: 500 });
  }
}
