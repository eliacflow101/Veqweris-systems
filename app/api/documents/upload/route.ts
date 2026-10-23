import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { withInstitutionCapacity } from "@/lib/platform/capacity";
import { requireInstitutionModuleEntitlement } from "@/lib/platform/tenant-entitlements";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const allowedMimeType = /^(text\/csv|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/pdf|image\/[a-z0-9.+-]+)$/i;

export async function POST(request: Request) {
  let storagePath: string | null = null;
  try {
    if (!adminDb || !adminStorage) {
      return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    }
    const token = await getSessionToken(request);
    if (!token) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const decoded = await verifyActiveSession(token);
    const profileSnapshot = await adminDb.collection("users").doc(decoded.uid).get();
    const profile = profileSnapshot.data();
    if (!profileSnapshot.exists || !profile || profile.status !== "active" || !profile.institutionId) {
      return NextResponse.json({ error: "Active institution membership is required." }, { status: 403 });
    }
    const institutionId = profile.institutionId as string;
    if (!["Owner", "Admin", "Manager", "Employee"].includes(profile.role)) {
      return NextResponse.json({ error: "Document upload is not permitted for this role." }, { status: 403 });
    }
    await requireInstitutionModuleEntitlement(institutionId, "documents");

    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "A document file is required." }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Documents must be between 1 byte and 25 MB." }, { status: 400 });
    }
    const mimeType = file.type || "application/octet-stream";
    if (!allowedMimeType.test(mimeType)) {
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
    if (["Manager", "Employee"].includes(profile.role)
      && departmentId && departmentId !== profile.departmentId) {
      return NextResponse.json({ error: "Documents can only be assigned to your department." }, { status: 403 });
    }
    const fileName = file.name.trim().slice(0, 180);
    if (!fileName) return NextResponse.json({ error: "The document name is required." }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) return NextResponse.json({ error: "The uploaded file size is inconsistent." }, { status: 400 });

    const ref = adminDb.collection("documents").doc();
    const extMatch = fileName.match(/\.([0-9A-Za-z]+)$/);
    const extension = extMatch ? extMatch[1] : "bin";
    storagePath = `quarantine/${institutionId}/${ref.id}_v1.${extension}`;
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
          uploadedBy: decoded.uid,
          uploadedAt: FieldValue.serverTimestamp(),
          status: "QUEUED",
          version: 1,
          module: moduleId,
          entityRef: form.get("entityRef") || null,
          departmentId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }),
      });
    } catch (reason) {
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
