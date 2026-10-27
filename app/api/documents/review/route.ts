import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { PermissionAuthorizationError, requirePermission } from "@/lib/permissions/server";
import { canReadDocument } from "@/lib/documents/access";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { documentId?: unknown; action?: unknown; comment?: unknown };
    const { documentId, action } = body;
    if (typeof documentId !== "string" || !documentId.trim()
      || (action !== "approve" && action !== "reject")
      || (body.comment !== undefined && (typeof body.comment !== "string" || body.comment.length > 500))) {
      return NextResponse.json({ error: "A document, review action, and a comment of at most 500 characters are required." }, { status: 400 });
    }
    if (!adminDb) return NextResponse.json({ error: "Document service is unavailable." }, { status: 503 });
    const context = await requirePermission(req, "documents.read");

    const docRef = adminDb.collection("documents").doc(documentId);
    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const doc = snap.data()!;
    if (!canReadDocument(doc, context)) return NextResponse.json({ error: "Document access is not authorized." }, { status: 403 });

    // Only Owner/Admin or Manager of matching department can review
    if (!(context.tier === "Owner" || context.tier === "Admin"
      || (context.tier === "Manager" && context.membership.departmentIds.includes(String(doc.departmentId ?? ""))))) {
      return NextResponse.json({ error: "Not permitted to review" }, { status: 403 });
    }

    if (action === "approve") {
      if (doc.scanStatus !== "CLEAN" || typeof doc.scanId !== "string"
        || typeof doc.scanSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(doc.scanSha256)) {
        return NextResponse.json({ error: "A verified clean scanner verdict is required before approval." }, { status: 409 });
      }
    }
    if (action === "reject") {
      if (!["NEEDS_REVIEW", "VALIDATED"].includes(doc.status)) {
        return NextResponse.json({ error: "Only documents awaiting review can be rejected." }, { status: 409 });
      }
    }

    const nextStatus = action === "approve" ? "VERIFIED" : "REJECTED";
    await adminDb.runTransaction(async (transaction) => {
      const current = await transaction.get(docRef);
      if (!current.exists || !canReadDocument(current.data() ?? {}, context)) throw new Error("DOCUMENT_CHANGED");
      if (!["NEEDS_REVIEW", "VALIDATED"].includes(String(current.get("status")))) throw new Error("DOCUMENT_CHANGED");
      if (action === "approve" && (current.get("scanStatus") !== "CLEAN"
        || typeof current.get("scanId") !== "string"
        || typeof current.get("scanSha256") !== "string"
        || !/^[a-f0-9]{64}$/i.test(current.get("scanSha256") as string))) {
        throw new Error("SCANNER_VERDICT_REQUIRED");
      }
      transaction.update(docRef, {
        status: nextStatus,
        ...(action === "approve" ? { verifiedBy: context.uid, verifiedAt: FieldValue.serverTimestamp() } : {}),
        reviewComment: body.comment ?? null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: context.uid,
      });
    });
    return NextResponse.json({ ok: true, status: nextStatus });
  } catch (err) {
    if (err instanceof PermissionAuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && err.message === "SCANNER_VERDICT_REQUIRED") {
      return NextResponse.json({ error: "A verified clean scanner verdict is required before approval." }, { status: 409 });
    }
    if (err instanceof Error && err.message === "DOCUMENT_CHANGED") {
      return NextResponse.json({ error: "The document changed; reload and try again." }, { status: 409 });
    }
    console.error("Document review failed.", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
