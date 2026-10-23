import { NextResponse } from "next/server";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { cookies } from "next/headers";
import { verifyActiveSession } from "@/lib/firebase/server-auth";
import { requireInstitutionModuleEntitlement } from "@/lib/platform/tenant-entitlements";

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
    const decoded = await verifyActiveSession(token);
    const uid = decoded.uid;

    const userSnap = await adminDb!.collection("users").doc(uid).get();
    if (!userSnap.exists) return NextResponse.json({ error: "User not found" }, { status: 403 });
    const user = userSnap.data()!;
    if (!user.institutionId) return NextResponse.json({ error: "Institution profile required" }, { status: 403 });
    await requireInstitutionModuleEntitlement(user.institutionId, "documents");

    const docRef = adminDb!.collection("documents").doc(documentId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const doc = docSnap.data()!;

    if (doc.institutionId !== user.institutionId) return NextResponse.json({ error: "Cross-institution" }, { status: 403 });
    if (!(user.role === "Owner" || user.role === "Admin" || (user.role === "Manager" && user.departmentId && user.departmentId === doc.departmentId))) {
      return NextResponse.json({ error: "Not permitted to promote" }, { status: 403 });
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
      if (!current.exists || current.get("institutionId") !== user.institutionId
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
        if (!current.exists || current.get("institutionId") !== user.institutionId
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
    console.error("promote route error", error);
    return NextResponse.json({ error: "Unable to promote document" }, { status: 500 });
  }
}
