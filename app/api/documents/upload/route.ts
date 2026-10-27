import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { withInstitutionCapacity } from "@/lib/platform/capacity";
import { requireInstitutionModuleEntitlement } from "@/lib/platform/tenant-entitlements";
import { PermissionAuthorizationError, requirePermission } from "@/lib/permissions/server";
import { canReadDocument } from "@/lib/documents/access";
import { validateDocumentMagicBytes } from "@/lib/documents/scanner";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export async function POST(request: Request) {
  let storagePath: string | null = null;
  try {
    if (!adminDb || !adminStorage) {
      return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    }
    const context = await requirePermission(request, "documents.read");
    const institutionId = context.institutionId;
    if (!["Owner", "Admin", "Manager", "Employee"].includes(context.tier)) {
      return NextResponse.json({ error: "Document upload is not permitted for this role." }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "A document file is required." }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Documents must be between 1 byte and 25 MB." }, { status: 400 });
    }
    const mimeType = file.type || "application/octet-stream";
    if (!allowedMimeTypes.has(mimeType.toLowerCase())) {
      return NextResponse.json({ error: "This document type is not supported." }, { status: 400 });
    }
    const moduleId = String(form.get("module") ?? "documents");
    if (moduleId !== "documents") await requireInstitutionModuleEntitlement(institutionId, moduleId);
    const requestedDepartment = form.get("departmentId");
    const departmentId = typeof requestedDepartment === "string" && requestedDepartment.trim()
      ? requestedDepartment.trim()
      : null;
    if (departmentId) {
      const department = await adminDb.collection("departments").doc(departmentId).get();
      if (!department.exists || department.get("institutionId") !== institutionId) {
        return NextResponse.json({ error: "The selected department is outside your institution." }, { status: 403 });
      }
    }
    if (["Manager", "Employee"].includes(context.tier)
      && departmentId && !context.membership.departmentIds.includes(departmentId)) {
      return NextResponse.json({ error: "Documents can only be assigned to your department." }, { status: 403 });
    }
    const fileName = file.name.trim().slice(0, 180);
    if (!fileName) return NextResponse.json({ error: "The document name is required." }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) return NextResponse.json({ error: "The uploaded file size is inconsistent." }, { status: 400 });
    if (!validateDocumentMagicBytes(bytes, mimeType)) {
      return NextResponse.json({ error: "File content does not match an allowed document type." }, { status: 400 });
    }

    const ref = adminDb.collection("documents").doc();
    const requestedSourceId = form.get("entityRef");
    const sourceId = typeof requestedSourceId === "string" && requestedSourceId.trim() ? requestedSourceId.trim() : null;
    const extMatch = fileName.match(/\.([0-9A-Za-z]+)$/);
    const extension = extMatch ? extMatch[1] : "bin";
    storagePath = `quarantine/${institutionId}/${ref.id}_v1.${extension}`;
    if (!canReadDocument({ institutionId, uploadedBy: context.uid, departmentId }, context)) {
      return NextResponse.json({ error: "Document access scope does not permit this upload." }, { status: 403 });
    }
    const storageFile = adminStorage.bucket().file(storagePath);
    await storageFile.save(bytes, { resumable: false, metadata: { contentType: mimeType } });

    try {
      await withInstitutionCapacity({
        db: adminDb,
        institutionId,
        limit: "maxStorageMb",
        amount: bytes.byteLength,
        write: (transaction) => transaction.create(ref, {
          documentId: ref.id,
          institutionId,
          name: fileName,
          type: null,
          mimeType,
          size: bytes.byteLength,
          storagePath,
          uploadedBy: context.uid,
          uploadedAt: FieldValue.serverTimestamp(),
          status: "QUEUED",
          scanStatus: "UPLOADED_QUARANTINED",
          version: 1,
          module: moduleId,
          entityRef: sourceId,
          ...(sourceId ? { sourceType: moduleId, sourceId } : {}),
          departmentId,
          createdBy: context.uid,
          updatedBy: context.uid,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          schemaVersion: 1,
        }),
      });
    } catch (reason) {
      if (reason instanceof PermissionAuthorizationError) {
        return NextResponse.json({ error: reason.message }, { status: reason.status });
      }
      try {
        await storageFile.delete();
      } catch (cleanupError) {
        console.error("Unable to remove a document blob after a rejected capacity transaction.", cleanupError);
      }
      throw reason;
    }
    return NextResponse.json({ documentId: ref.id, storagePath }, { status: 201 });
  } catch (reason) {
    const code = reason instanceof Error ? reason.message : "";
    const status = code === "UNAUTHENTICATED" ? 401
      : code === "FORBIDDEN" ? 403
        : code.startsWith("PLAN_LIMIT_EXCEEDED") ? 409 : 400;
    if (status === 400) console.error("Unable to upload document.", reason);
    return NextResponse.json({
      error: status === 409 ? "The institution has reached its storage plan limit."
        : status === 403 ? "Document upload is unavailable for this institution."
          : status === 401 ? "Authentication required." : "Unable to upload document.",
    }, { status });
  }
}
