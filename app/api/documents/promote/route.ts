import { NextResponse } from "next/server";
import { adminDb, adminStorage, adminAuth } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { cookies } from "next/headers";

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
    await sourceFile.move(destinationFile);

    await docRef.update({
      status: "AVAILABLE",
      storagePath: destPath,
      updatedAt: FieldValue.serverTimestamp(),
      availableAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, storagePath: destPath, status: "AVAILABLE" });
  } catch (error) {
    console.error("promote route error", error);
    return NextResponse.json({ error: "Unable to promote document" }, { status: 500 });
  }
}
