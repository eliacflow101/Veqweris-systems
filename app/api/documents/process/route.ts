import { NextResponse } from "next/server";
import { adminDb, adminAuth } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { cookies } from "next/headers";
import { runDocumentProcessingPipeline } from "@/lib/documents/processing";

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
    const { documentId } = body;
    if (!documentId) return NextResponse.json({ error: "documentId required" }, { status: 400 });

    const token = await getSessionToken(req);
    if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const decoded = await adminAuth!.verifyIdToken(token);
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

    if (!(role === "Owner" || role === "Admin" || (role === "Manager" && user.departmentId && user.departmentId === doc.departmentId) || uid === doc.uploadedBy)) {
      return NextResponse.json({ error: "Not permitted to process" }, { status: 403 });
    }

    await docRef.update({ status: "PROCESSING", updatedAt: FieldValue.serverTimestamp() });

    const result = await runDocumentProcessingPipeline({
      fileName: doc.name,
      mimeType: doc.mimeType || "application/octet-stream",
      size: Number(doc.size || 0),
      storagePath: doc.storagePath,
    });

    const updates: Record<string, unknown> = {
      status: result.status,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (result.extractedText) {
      updates.extractedText = result.extractedText;
    }
    if (result.reason) {
      updates.processingReason = result.reason;
    }
    if (result.status === "VALIDATED") {
      updates.verifiedBy = uid;
      updates.verifiedAt = FieldValue.serverTimestamp();
    }

    await docRef.update(updates);

    return NextResponse.json({ ok: true, status: result.status, reason: result.reason });
  } catch (err) {
    console.error("process route error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
