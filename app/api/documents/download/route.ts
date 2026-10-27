import { NextResponse } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { PermissionAuthorizationError, requirePermission } from "@/lib/permissions/server";
import { canReadDocument } from "@/lib/documents/access";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const documentId = url.searchParams.get("documentId");
  if (!path && !documentId) return NextResponse.json({ error: "path or documentId is required" }, { status: 400 });

  if (!adminStorage || !adminDb) {
    return NextResponse.json({ error: "Storage is not configured on the server" }, { status: 501 });
  }

  try {
    const context = await requirePermission(req, "documents.read");

    let documentData: DocumentData | undefined;
    if (documentId) {
      const docSnap = await adminDb.collection("documents").doc(documentId).get();
      if (!docSnap.exists) return NextResponse.json({ error: "Document metadata not found" }, { status: 404 });
      documentData = docSnap.data();
    } else {
      const docs = await adminDb.collection("documents").where("storagePath", "==", path).limit(1).get();
      if (docs.empty) return NextResponse.json({ error: "Document metadata not found" }, { status: 404 });
      documentData = docs.docs[0].data();
    }
    if (!documentData || !canReadDocument(documentData, context)) {
      return NextResponse.json({ error: "Document access is not authorized." }, { status: 403 });
    }
    if (documentData.status !== "AVAILABLE") {
      return NextResponse.json({ error: "Document is not available for download" }, { status: 403 });
    }
    if (documentData.scanStatus !== "CLEAN" || typeof documentData.scanId !== "string"
      || typeof documentData.scanSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(documentData.scanSha256)) {
      return NextResponse.json({ error: "The document has no verified clean scanner verdict." }, { status: 403 });
    }
    if (typeof documentData.storagePath !== "string") {
      return NextResponse.json({ error: "Document storage is unavailable." }, { status: 404 });
    }

    const bucket = adminStorage.bucket();
    const file = bucket.file(documentData.storagePath);
    const [signedUrl] = await file.getSignedUrl({ action: "read", expires: Date.now() + 5 * 60 * 1000 });
    return NextResponse.redirect(signedUrl);
  } catch (err) {
    if (err instanceof PermissionAuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Error generating download url", err);
    return NextResponse.json({ error: "Unable to generate download URL" }, { status: 500 });
  }
}
