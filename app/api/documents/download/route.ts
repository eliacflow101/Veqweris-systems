import { NextResponse } from "next/server";
import { adminDb, adminStorage, adminAuth } from "@/lib/firebase/admin";
import { cookies } from "next/headers";
import { verifyActiveSession } from "@/lib/firebase/server-auth";

async function getSessionToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const tokenFromHeader = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
  if (tokenFromHeader) return tokenFromHeader;
  const cookieStore = await cookies();
  return cookieStore.get("__session")?.value ?? null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const documentId = url.searchParams.get("documentId");
  if (!path && !documentId) return NextResponse.json({ error: "path or documentId is required" }, { status: 400 });

  if (!adminStorage || !adminDb) {
    return NextResponse.json({ error: "Storage is not configured on the server" }, { status: 501 });
  }

  try {
    const token = await getSessionToken(req);
    if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const decoded = await verifyActiveSession(token);
    const userSnap = await adminDb.collection("users").doc(decoded.uid).get();
    if (!userSnap.exists) return NextResponse.json({ error: "User not found" }, { status: 403 });
    const user = userSnap.data()!;

    let docPath = path;
    if (!docPath && documentId) {
      const docSnap = await adminDb.collection("documents").doc(documentId).get();
      if (!docSnap.exists) return NextResponse.json({ error: "Document metadata not found" }, { status: 404 });
      const doc = docSnap.data()!;
      if (doc.status !== "AVAILABLE") return NextResponse.json({ error: "Document is not available for download" }, { status: 403 });
      if (doc.institutionId !== user.institutionId) return NextResponse.json({ error: "Cross-institution access denied" }, { status: 403 });
      docPath = doc.storagePath;
    } else {
      const docs = await adminDb.collection("documents").where("storagePath", "==", path).limit(1).get();
      if (docs.empty) return NextResponse.json({ error: "Document metadata not found" }, { status: 404 });
      const doc = docs.docs[0].data();
      if (doc.status !== "AVAILABLE") return NextResponse.json({ error: "Document is not available for download" }, { status: 403 });
      if (doc.institutionId !== user.institutionId) return NextResponse.json({ error: "Cross-institution access denied" }, { status: 403 });
    }

    const bucket = adminStorage.bucket();
    const file = bucket.file(docPath as string);
    const [signedUrl] = await file.getSignedUrl({ action: "read", expires: Date.now() + 5 * 60 * 1000 });
    return NextResponse.redirect(signedUrl);
  } catch (err) {
    console.error("Error generating download url", err);
    return NextResponse.json({ error: "Unable to generate download URL" }, { status: 500 });
  }
}
