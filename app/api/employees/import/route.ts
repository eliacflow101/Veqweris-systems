import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { buildImportPreview } from "@/lib/people-engine";
import {
  EmployeeImportCsvError,
  MAX_EMPLOYEE_IMPORT_BYTES,
  MAX_EMPLOYEE_IMPORT_ROWS,
  parseEmployeeImportCsv,
} from "@/lib/employee-import/csv";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { requireInstitutionModuleEntitlement } from "@/lib/platform/tenant-entitlements";

export async function POST(request: Request) {
  try {
    if (!adminAuth || !adminDb) {
      return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    }

    const sessionToken = await getSessionToken(request);
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

    if (typeof file === "string") {
      return NextResponse.json({ error: "The import must be a CSV file." }, { status: 400 });
    }

    const fileName = file.name || "employee-import.csv";
    if (fileName.split(".").pop()?.toLowerCase() !== "csv") {
      return NextResponse.json({ error: "Only UTF-8 CSV files are accepted." }, { status: 400 });
    }

    const size = file.size;
    if (size <= 0 || size > MAX_EMPLOYEE_IMPORT_BYTES) {
      return NextResponse.json({ error: "Import files must be between 1 byte and 5 MB." }, { status: 400 });
    }

    const rows = parseEmployeeImportCsv(new Uint8Array(await file.arrayBuffer()));

    const institutionId = userData.institutionId;
    await requireInstitutionModuleEntitlement(institutionId, "employees");
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

    const batchRef = adminDb.collection("bulkImportBatches").doc();
    const auditRef = adminDb.collection("securityEvents").doc();
    await adminDb.runTransaction(async (transaction) => {
      transaction.create(batchRef, {
        batchId: batchRef.id,
        institutionId,
        createdBy: decoded.uid,
        fileName,
        sourceType: "csv",
        status: "pending_review",
        rows: preview,
        validCount,
        rejectedCount,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(auditRef, {
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
    });

    return NextResponse.json({
      batchId: batchRef.id,
      preview,
      validCount,
      rejectedCount,
      message: "Import preview ready for review.",
    });
  } catch (reason) {
    if (reason instanceof EmployeeImportCsvError) {
      const message = reason.code === "too-large"
        ? "Import files must not exceed 5 MB."
        : reason.code === "too-many-rows"
          ? `Import files must not exceed ${MAX_EMPLOYEE_IMPORT_ROWS} data rows.`
          : reason.code === "empty"
            ? "The CSV file contains no data rows."
            : "The uploaded file is not a valid UTF-8 CSV file.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("Unable to import employee batch.", reason);
    return NextResponse.json({ error: "Unable to process the employee import file." }, { status: 500 });
  }
}
