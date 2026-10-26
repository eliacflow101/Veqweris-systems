import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { buildImportPreview } from "@/lib/people-engine";
import {
  EmployeeImportCsvError,
  MAX_EMPLOYEE_IMPORT_BYTES,
  MAX_EMPLOYEE_IMPORT_COLUMNS,
  MAX_EMPLOYEE_IMPORT_PREVIEW_BYTES,
  MAX_EMPLOYEE_IMPORT_ROWS,
  parseEmployeeImportCsv,
} from "@/lib/employee-import/csv";
import { EmployeeImportError } from "@/lib/employee-import/errors";
import { parseEmployeeImportXlsx } from "@/lib/employee-import/xlsx";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { requireInstitutionModuleEntitlement } from "@/lib/platform/tenant-entitlements";

const MAX_IMPORT_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const runtime = "nodejs";

async function readBoundedImportForm(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new EmployeeImportCsvError("invalid");
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_EMPLOYEE_IMPORT_BYTES + MAX_IMPORT_MULTIPART_OVERHEAD_BYTES) {
    throw new EmployeeImportCsvError("too-large");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new EmployeeImportCsvError("invalid");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_EMPLOYEE_IMPORT_BYTES + MAX_IMPORT_MULTIPART_OVERHEAD_BYTES) {
      await reader.cancel();
      throw new EmployeeImportCsvError("too-large");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks, totalBytes);
  try {
    return await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body,
    }).formData();
  } catch {
    throw new EmployeeImportCsvError("invalid");
  }
}

export async function POST(request: Request) {
  let importExtension: "csv" | "xlsx" | "unknown" = "unknown";
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

    if (!userSnapshot.exists || !userData || userData.status !== "active" || !userData.institutionId
      || !["Owner", "Admin"].includes(userData.role)) {
      return NextResponse.json({ error: "Only Owners and Admins can import employees." }, { status: 403 });
    }

    const formData = await readBoundedImportForm(request);
    const file = formData.get("file");
    if (!file) {
      return NextResponse.json({ error: "No import file was provided." }, { status: 400 });
    }

    if (typeof file === "string") {
      return NextResponse.json({ error: "Choose a CSV or XLSX file." }, { status: 400 });
    }

    const fileName = (file.name.replace(/\\/g, "/").split("/").pop() ?? "").replace(/[\u0000-\u001f]/g, "").slice(0, 120);
    const extension = fileName.split(".").pop()?.toLowerCase();
    if (extension !== "csv" && extension !== "xlsx") {
      return NextResponse.json({ error: "Only UTF-8 CSV and non-macro XLSX files are accepted." }, { status: 400 });
    }
    importExtension = extension;

    const size = file.size;
    if (size <= 0) {
      return NextResponse.json({ error: "Import files must be between 1 byte and 5 MB." }, { status: 400 });
    }
    if (size > MAX_EMPLOYEE_IMPORT_BYTES) throw new EmployeeImportError("too-large");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const rows = extension === "xlsx"
      ? await parseEmployeeImportXlsx(bytes)
      : parseEmployeeImportCsv(bytes);

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
    if (Buffer.byteLength(JSON.stringify(preview), "utf8") > MAX_EMPLOYEE_IMPORT_PREVIEW_BYTES) {
      throw new EmployeeImportError("preview-too-large");
    }
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
        sourceType: extension,
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
    if (reason instanceof EmployeeImportError) {
      const message = reason.code === "too-large"
        ? "Import files must not exceed 5 MB and must stay within workbook resource limits."
        : reason.code === "too-many-rows"
          ? `Import files must not exceed ${MAX_EMPLOYEE_IMPORT_ROWS} data rows.`
          : reason.code === "too-many-columns"
            ? `Workbooks must not exceed ${MAX_EMPLOYEE_IMPORT_COLUMNS} columns.`
          : reason.code === "empty"
            ? "The import file contains no data rows."
            : reason.code === "busy"
              ? "Another workbook is currently being processed. Try again shortly."
              : reason.code === "timeout"
                ? "The workbook exceeded the processing time limit."
                : reason.code === "preview-too-large"
                  ? "The employee preview is too large to store safely. Reduce the workbook data and try again."
                  : reason.code === "unsupported"
                    ? "The workbook contains unsupported features or cell types."
                      : importExtension === "xlsx"
                        ? "The uploaded file is not a valid supported XLSX workbook."
                        : "The uploaded file is not a valid UTF-8 CSV file.";
      return NextResponse.json({ error: message }, { status: reason.code === "busy" ? 429 : 400 });
    }

    console.error("Unable to import employee batch.", reason);
    return NextResponse.json({ error: "Unable to process the employee import file." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    const sessionToken = await getSessionToken(request);
    if (!sessionToken) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const decoded = await verifyActiveSession(sessionToken);
    const userSnapshot = await adminDb.collection("users").doc(decoded.uid).get();
    const userData = userSnapshot.data();
    if (!userSnapshot.exists || !userData || userData.status !== "active" || !userData.institutionId
      || !["Owner", "Admin"].includes(userData.role)) {
      return NextResponse.json({ error: "Only active institution Owners and Admins can cancel imports." }, { status: 403 });
    }
    await requireInstitutionModuleEntitlement(userData.institutionId, "employees");
    const body = await request.json() as { batchId?: string };
    if (typeof body.batchId !== "string" || !body.batchId.trim()) {
      return NextResponse.json({ error: "batchId is required." }, { status: 400 });
    }
    const batchRef = adminDb.collection("bulkImportBatches").doc(body.batchId);
    const auditRef = adminDb.collection("securityEvents").doc();
    const cancelled = await adminDb.runTransaction(async (transaction) => {
      const batch = await transaction.get(batchRef);
      if (!batch.exists || batch.get("institutionId") !== userData.institutionId) return false;
      if (batch.get("status") !== "pending_review") throw new Error("IMPORT_NOT_CANCELLABLE");
      transaction.update(batchRef, {
        status: "cancelled",
        cancelledBy: decoded.uid,
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(auditRef, {
        eventId: auditRef.id,
        institutionId: userData.institutionId,
        uid: decoded.uid,
        type: "sensitive_action",
        source: "employees.import",
        details: { action: "bulk_import_cancelled", batchId: batchRef.id },
        createdAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!cancelled) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
    return NextResponse.json({ batchId: batchRef.id, status: "cancelled" });
  } catch (reason) {
    if (reason instanceof Error && reason.message === "IMPORT_NOT_CANCELLABLE") {
      return NextResponse.json({ error: "This import can no longer be cancelled." }, { status: 409 });
    }
    console.error("Unable to cancel employee import.", reason);
    return NextResponse.json({ error: "Unable to cancel the employee import." }, { status: 500 });
  }
}
