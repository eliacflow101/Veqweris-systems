import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { withInstitutionCapacity } from "@/lib/platform/capacity";
import { requireInstitutionModuleEntitlement } from "@/lib/platform/tenant-entitlements";

export async function POST(request: Request) {
  try {
    if (!adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    const token = await getSessionToken(request);
    if (!token) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const decoded = await verifyActiveSession(token);
    const profileSnapshot = await adminDb.collection("users").doc(decoded.uid).get();
    const profile = profileSnapshot.data();
    if (!profileSnapshot.exists || !profile || profile.status !== "active" || !profile.institutionId
      || !["Owner", "Admin"].includes(profile.role)) {
      return NextResponse.json({ error: "Department administration access is required." }, { status: 403 });
    }
    const institutionId = profile.institutionId as string;
    await requireInstitutionModuleEntitlement(institutionId, "departments");
    const body = await request.json() as {
      departmentId?: string;
      name?: string;
      departmentCode?: string;
      description?: string;
      headUserId?: string | null;
    };
    if (!body.name?.trim() || !body.departmentCode?.trim()) {
      return NextResponse.json({ error: "Department name and code are required." }, { status: 400 });
    }
    const departmentRef = body.departmentId
      ? adminDb.collection("departments").doc(body.departmentId)
      : adminDb.collection("departments").doc();
    const payload = {
      departmentId: departmentRef.id,
      institutionId,
      name: body.name.trim(),
      departmentCode: body.departmentCode.trim(),
      description: body.description?.trim() ?? "",
      headUserId: body.headUserId?.trim() || null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const headUserRef = payload.headUserId ? adminDb.collection("users").doc(payload.headUserId) : null;

    if (body.departmentId) {
      await adminDb.runTransaction(async (transaction) => {
        const current = await transaction.get(departmentRef);
        if (!current.exists || current.get("institutionId") !== institutionId) throw new Error("DEPARTMENT_NOT_FOUND");
        if (headUserRef) {
          const headUser = await transaction.get(headUserRef);
          if (!headUser.exists || headUser.get("institutionId") !== institutionId || headUser.get("role") !== "Manager") {
            throw new Error("DEPARTMENT_HEAD_INVALID");
          }
        }
        transaction.set(departmentRef, payload, { merge: true });
      });
      return NextResponse.json({ departmentId: departmentRef.id });
    }

    await withInstitutionCapacity({
      db: adminDb,
      institutionId,
      limit: "maxDepartments",
      amount: 1,
      readRefs: headUserRef ? [headUserRef] : [],
      write: (transaction, reads) => {
        const headUser = reads[0];
        if (headUserRef && (!headUser?.exists || headUser.get("institutionId") !== institutionId || headUser.get("role") !== "Manager")) {
          throw new Error("DEPARTMENT_HEAD_INVALID");
        }
        transaction.create(departmentRef, {
          ...payload,
          status: "active",
          createdAt: FieldValue.serverTimestamp(),
        });
      },
    });
    return NextResponse.json({ departmentId: departmentRef.id }, { status: 201 });
  } catch (reason) {
    const code = reason instanceof Error ? reason.message : "";
    const status = code === "UNAUTHENTICATED" ? 401
      : code === "FORBIDDEN" || code === "DEPARTMENT_NOT_FOUND" ? 403
        : code.startsWith("PLAN_LIMIT_EXCEEDED") ? 409 : 400;
    return NextResponse.json({
      error: status === 409 ? "The institution has reached its department plan limit."
        : status === 403 ? "Department administration access is unavailable."
          : "Unable to save department.",
    }, { status });
  }
}
