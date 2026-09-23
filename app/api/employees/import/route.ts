import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { buildImportPreview } from "@/lib/people-engine";
import { verifyActiveSession } from "@/lib/firebase/server-auth";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMPORT_EXTENSIONS = new Set(["csv", "xls", "xlsx"]);

export async function POST(request: Request) {
  try {
    if (!adminAuth || !adminDb) {
      return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    }

    const sessionToken = (await cookies()).get("__session")?.value;
    if (!sessionToken) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const decoded = await verifyActiveSession(sessionToken);
    const userSnapshot = await adminDb.collection("users").doc(decoded.uid).get();
    const userData = userSnapshot.data();

    if (!userSnapshot.exists || !userData || !["Owner", "Admin"].includes(userData.role)) {
      return NextResponse.json({ error: "Only Owners and Admins can import employees." }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) {
      return NextResponse.json({ error: "No import file was provided." }, { status: 400 });
    }

    // In Next.js request.formData() returns Web File-like objects; convert to buffer
    const fileName = (file as any).name ?? "employee-import";
    const extension = String(fileName).split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_IMPORT_EXTENSIONS.has(extension)) {
      return NextResponse.json({ error: "Only CSV and Excel files are accepted." }, { status: 400 });
    }

    const size = (file as any).size ?? 0;
    if (size <= 0 || size > MAX_IMPORT_BYTES) {
      return NextResponse.json({ error: "Import files must be between 1 byte and 5 MB." }, { status: 400 });
    }

    const arrayBuffer = await (file as any).arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse workbook
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) {
      return NextResponse.json({ error: "The uploaded file is empty or unreadable." }, { status: 400 });
    }

    // Convert sheet to JSON rows using header row detection
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: false }) as Record<string, unknown>[];
    if (!rows.length) {
      return NextResponse.json({ error: "No data rows were found in the imported file." }, { status: 400 });
    }

    const institutionId = userData.institutionId;
    // Load existing users in institution for duplicate detection
    const existingUsersSnap = await adminDb.collection("users").where("institutionId", "==", institutionId).get();
    const existing = existingUsersSnap.docs.map((snapshot) => {
      const data = snapshot.data();
      return {
        rowId: snapshot.id,
        institutionEmployeeId: data.institutionEmployeeId ?? "",
        fullName: data.fullName ?? "",
        officialEmail: data.email ?? "",
        phone: data.phone ?? "",
        department: data.departmentId ?? "",
        role: data.role ?? "",
        position: data.position ?? "",
        employmentType: data.employmentType ?? "",
        status: data.status ?? "active",
      };
    });

    // Build preview and simple validation
    const preview = buildImportPreview(rows, existing);
    const validCount = preview.filter((row) => row.allowed).length;
    const rejectedCount = preview.filter((row) => !row.allowed).length;

    // Persist batch for review
    const batchRef = adminDb.collection("bulkImportBatches").doc();
    await batchRef.set({
      batchId: batchRef.id,
      institutionId,
      createdBy: decoded.uid,
      fileName,
      sourceType: extension === "csv" ? "csv" : "xlsx",
      status: "pending_review",
      rows: preview,
      validCount,
      rejectedCount,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Log audit/security event
    const auditRef = adminDb.collection("securityEvents").doc();
    await auditRef.set({
      eventId: auditRef.id,
      institutionId,
      uid: decoded.uid,
      type: "sensitive_action",
      source: "employees.import",
      details: {
        action: "bulk_import_preview",
        fileName,
        validCount,
        rejectedCount,
        batchId: batchRef.id,
      },
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      batchId: batchRef.id,
      preview,
      validCount,
      rejectedCount,
      message: "Import preview ready for review.",
    });
  } catch (reason) {
    console.error("Unable to import employee batch.", reason);
    return NextResponse.json({ error: "Unable to process the employee import file." }, { status: 500 });
  }
}
