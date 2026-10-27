import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { PermissionAuthorizationError, requirePermission } from "@/lib/permissions/server";
import { canReadDocument } from "@/lib/documents/access";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { documentId } = body;
    if (!documentId) return NextResponse.json({ error: "documentId required" }, { status: 400 });

    const context = await requirePermission(req, "documents.read");

    const docRef = adminDb!.collection("documents").doc(documentId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const doc = docSnap.data()!;

    if (!canReadDocument(doc, context)) return NextResponse.json({ error: "Document access is not authorized." }, { status: 403 });
    if (!(context.tier === "Owner" || context.tier === "Admin"
      || (context.tier === "Manager" && context.membership.departmentIds.includes(String(doc.departmentId ?? ""))))) {
      return NextResponse.json({ error: "Not permitted to promote" }, { status: 403 });
    }
    if (doc.scanStatus !== "CLEAN" || typeof doc.scanId !== "string"
      || typeof doc.scanSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(doc.scanSha256)) {
      return NextResponse.json({ error: "A verified clean scanner verdict is required before promotion." }, { status: 409 });
    }
    if (doc.status !== "VERIFIED") return NextResponse.json({ error: "Only verified documents can be promoted" }, { status: 400 });

    const srcPath = doc.storagePath;
    const extMatch = doc.name.match(/\.([0-9A-Za-z]+)$/);
    const ext = extMatch ? extMatch[1] : "bin";
    const destPath = `documents/${doc.institutionId}/${doc.documentId}_v${doc.version}.${ext}`;

    const sourceFile = adminStorage!.bucket().file(srcPath);
    const destinationFile = adminStorage!.bucket().file(destPath);
    await adminDb!.runTransaction(async (transaction) => {
      const current = await transaction.get(docRef);
      if (!current.exists || !canReadDocument(current.data() ?? {}, context)
        || current.get("status") !== "VERIFIED" || current.get("storagePath") !== srcPath) {
        throw new Error("DOCUMENT_CHANGED");
      }
      transaction.update(docRef, { status: "PROMOTING", updatedAt: FieldValue.serverTimestamp() });
    });
    let moved = false;
    try {
      await sourceFile.move(destinationFile);
      moved = true;
      await adminDb!.runTransaction(async (transaction) => {
        const current = await transaction.get(docRef);
        if (!current.exists || !canReadDocument(current.data() ?? {}, context)
          || current.get("status") !== "PROMOTING" || current.get("storagePath") !== srcPath) {
          throw new Error("DOCUMENT_CHANGED");
        }
        transaction.update(docRef, {
          status: "AVAILABLE",
          storagePath: destPath,
          updatedAt: FieldValue.serverTimestamp(),
          availableAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (reason) {
      let restored = !moved;
      if (moved) {
        try {
          await destinationFile.move(sourceFile);
          restored = true;
        } catch (cleanupError) {
          console.error("Unable to restore a document blob after a failed promotion.", cleanupError);
        }
      }
      try {
        await adminDb!.runTransaction(async (transaction) => {
          const current = await transaction.get(docRef);
          if (current.exists && current.get("status") === "PROMOTING" && current.get("storagePath") === srcPath) {
            transaction.update(docRef, {
              status: restored ? "VERIFIED" : "ERROR",
              ...(restored ? {} : { processingReason: "Storage promotion recovery is required." }),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
        });
      } catch (recoveryError) {
        console.error("Unable to record document promotion recovery state.", recoveryError);
      }
      throw reason;
    }

    return NextResponse.json({ ok: true, storagePath: destPath, status: "AVAILABLE" });
  } catch (error) {
    if (error instanceof PermissionAuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("promote route error", error);
    return NextResponse.json({ error: "Unable to promote document" }, { status: 500 });
  }
}
