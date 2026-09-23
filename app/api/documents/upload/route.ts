import { NextResponse } from "next/server";
import { adminDb, adminStorage, adminAuth } from "@/lib/firebase/admin";
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
    const { name, mimeType, size, institutionId, module, entityRef, departmentId } = body;
    if (!name || !mimeType || !size || !institutionId) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

    const token = await getSessionToken(req);
    if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const decoded = await verifyActiveSession(token);
    const uid = decoded.uid;

    // Verify user's institution matches the requested one
    const userDoc = await adminDb!.collection("users").doc(uid).get();
    if (!userDoc.exists || userDoc.data()?.institutionId !== institutionId) return NextResponse.json({ error: "Invalid institution" }, { status: 403 });

    // Create a new document metadata entry in quarantine state (QUEUED)
    const ref = adminDb!.collection("documents").doc();
    const documentId = ref.id;
    const version = 1;
    const extMatch = name.match(/\.([0-9A-Za-z]+)$/);
    const ext = extMatch ? extMatch[1] : "bin";
    const storagePath = `quarantine/${institutionId}/${documentId}_v${version}.${ext}`;

    await ref.set({
      documentId,
      institutionId,
      name,
      type: body.type || null,
      mimeType,
      size,
      storagePath,
      uploadedBy: uid,
      uploadedAt: FieldValue.serverTimestamp(),
      status: "QUEUED",
      version,
      module: module ?? null,
      entityRef: entityRef ?? null,
      departmentId: departmentId ?? null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Generate signed upload URL for the client to PUT the file into quarantine
    const bucket = adminStorage!.bucket();
    const file = bucket.file(storagePath);
    const [url] = await file.getSignedUrl({ action: "write", expires: Date.now() + 5 * 60 * 1000 });

    return NextResponse.json({ documentId, uploadUrl: url, storagePath });
  } catch (err) {
    console.error("upload route error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
