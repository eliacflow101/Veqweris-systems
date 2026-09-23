import { NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { cookies } from "next/headers";
import { verifyActiveSession } from "@/lib/firebase/server-auth";

async function getSessionToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const tokenFromHeader = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
  if (tokenFromHeader) return tokenFromHeader;
  const cookieStore = await cookies();
  return cookieStore.get("__session")?.value ?? null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { documentId, action, comment } = body; // action: "approve" | "reject"
    if (!documentId || !action) return NextResponse.json({ error: "documentId and action are required" }, { status: 400 });

    const token = await getSessionToken(req);
    if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const decoded = await verifyActiveSession(token);
    const uid = decoded.uid;

    const userSnap = await adminDb!.collection("users").doc(uid).get();
    if (!userSnap.exists) return NextResponse.json({ error: "User not found" }, { status: 403 });
    const user = userSnap.data()!;
    const role = user.role as string;

    const docRef = adminDb!.collection("documents").doc(documentId);
    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const doc = snap.data()!;

    if (doc.institutionId !== user.institutionId) return NextResponse.json({ error: "Cross-institution" }, { status: 403 });

    // Only Owner/Admin or Manager of matching department can review
    if (!(role === "Owner" || role === "Admin" || (role === "Manager" && user.departmentId && user.departmentId === doc.departmentId))) {
      return NextResponse.json({ error: "Not permitted to review" }, { status: 403 });
    }

    if (action === "approve") {
      await docRef.update({ status: "VERIFIED", verifiedBy: uid, verifiedAt: FieldValue.serverTimestamp(), reviewComment: comment ?? null, updatedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ ok: true, status: "VERIFIED" });
    }
    if (action === "reject") {
      await docRef.update({ status: "REJECTED", reviewComment: comment ?? null, updatedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ ok: true, status: "REJECTED" });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("review route error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
