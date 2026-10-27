import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { runDocumentProcessingPipeline } from "@/lib/documents/processing";
import { createConfiguredScannerAdapter, scanQuarantinedDocument } from "@/lib/documents/scanner";
import { PermissionAuthorizationError, requirePermission } from "@/lib/permissions/server";
import { canReadDocument } from "@/lib/documents/access";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { documentId?: unknown };
    if (typeof body.documentId !== "string" || !body.documentId.trim()) {
      return NextResponse.json({ error: "A document ID is required." }, { status: 400 });
    }
    if (!adminDb) return NextResponse.json({ error: "Document service is unavailable." }, { status: 503 });
    const context = await requirePermission(req, "documents.read");
    const uid = context.uid;

    const docRef = adminDb.collection("documents").doc(body.documentId);
    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const doc = snap.data()!;

    if (!canReadDocument(doc, context)) return NextResponse.json({ error: "Document access is not authorized." }, { status: 403 });
    if (!(context.tier === "Owner" || context.tier === "Admin"
      || (context.tier === "Manager" && context.membership.departmentIds.includes(String(doc.departmentId ?? "")))
      || uid === doc.uploadedBy)) {
      return NextResponse.json({ error: "Not permitted to process" }, { status: 403 });
    }

    await adminDb.runTransaction(async (transaction) => {
      const current = await transaction.get(docRef);
      if (!current.exists || !canReadDocument(current.data() ?? {}, context)) throw new Error("DOCUMENT_CHANGED");
      const currentStatus = String(current.get("status"));
      const scanStatus = String(current.get("scanStatus"));
      const updatedAt = current.get("updatedAt");
      const staleProcessing = currentStatus === "PROCESSING" && scanStatus === "SCANNING"
        && updatedAt instanceof Timestamp && updatedAt.toMillis() < Date.now() - 10 * 60 * 1000;
      if (!["QUEUED", "FAILED"].includes(currentStatus) && !staleProcessing) {
        throw new Error("DOCUMENT_NOT_PROCESSABLE");
      }
      transaction.update(docRef, {
        status: "PROCESSING",
        scanStatus: "SCANNING",
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      });
    });

    const scan = await scanQuarantinedDocument({
      institutionId: context.institutionId,
      storagePath: doc.storagePath,
      mimeType: doc.mimeType || "application/octet-stream",
    }, createConfiguredScannerAdapter());
    if (scan.status !== "CLEAN") {
      const failedStatus = scan.status === "INFECTED" ? "REJECTED" : "FAILED";
      await docRef.update({
        status: failedStatus,
        scanStatus: scan.status === "INFECTED" ? "INFECTED" : "SCAN_FAILED",
        scanReason: scan.reason,
        scannedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({
        ok: false,
        status: failedStatus,
        scanStatus: scan.status === "INFECTED" ? "INFECTED" : "SCAN_FAILED",
        error: scan.reason,
      }, { status: scan.status === "INFECTED" ? 422 : 503 });
    }

    const result = await runDocumentProcessingPipeline({
      fileName: doc.name,
      mimeType: doc.mimeType || "application/octet-stream",
      size: Number(doc.size || 0),
      storagePath: doc.storagePath,
      scanStatus: "CLEAN",
    });

    const updates: Record<string, unknown> = {
      status: result.status,
      scanStatus: "CLEAN",
      scanId: scan.scanId,
      scanSha256: scan.sha256,
      scannedAt: FieldValue.serverTimestamp(),
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
    if (err instanceof PermissionAuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Error && err.message === "DOCUMENT_CHANGED") {
      return NextResponse.json({ error: "The document changed; reload and try again." }, { status: 409 });
    }
    if (err instanceof Error && err.message === "DOCUMENT_NOT_PROCESSABLE") {
      return NextResponse.json({ error: "This document is not queued for processing." }, { status: 409 });
    }
    console.error("Document processing failed.", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
