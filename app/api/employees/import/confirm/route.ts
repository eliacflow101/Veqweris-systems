import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { createPeopleDirectoryEntry } from "@/lib/people-engine";

export async function POST(request: Request) {
  try {
    if (!adminAuth || !adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });

    const sessionToken = (await cookies()).get("__session")?.value;
    if (!sessionToken) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(sessionToken);
    const userSnapshot = await adminDb.collection("users").doc(decoded.uid).get();
    const userData = userSnapshot.data();
    if (!userSnapshot.exists || !userData || !["Owner", "Admin"].includes(userData.role)) {
      return NextResponse.json({ error: "Only Owners and Admins can confirm imports." }, { status: 403 });
    }

    const body = await request.json();
    const batchId = body?.batchId;
    if (!batchId) return NextResponse.json({ error: "batchId is required." }, { status: 400 });

    const batchRef = adminDb.collection("bulkImportBatches").doc(batchId);
    const batchSnap = await batchRef.get();
    if (!batchSnap.exists) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });

    const batch = batchSnap.data() as any;
    if (batch.status !== "pending_review") return NextResponse.json({ error: "Import batch is not pending review." }, { status: 400 });

    const institutionId = batch.institutionId;
    const rows: any[] = batch.rows ?? [];

    const results = [] as any[];
    let createdCount = 0;

    for (const row of rows) {
      try {
        if (!row.allowed) { results.push({ rowId: row.rowId, status: "skipped", reason: "Not allowed / validation failed" }); continue; }
        const email = (row.officialEmail || "").toLowerCase();
        // skip if existing user by email
        const existingByEmail = await adminDb.collection("users").where("email", "==", email).where("institutionId", "==", institutionId).get();
        if (!existingByEmail.empty) { results.push({ rowId: row.rowId, status: "skipped", reason: "User already exists with email" }); continue; }

        // ensure institutionEmployeeId
        const instEmpId = row.institutionEmployeeId && row.institutionEmployeeId.trim() ? row.institutionEmployeeId : null;
        const existingIds = [] as string[];
        const personTemplate = createPeopleDirectoryEntry({
          institutionId,
          fullName: row.fullName || "",
          email,
          departmentId: row.department || null,
          role: row.role || "Employee",
          position: row.position || "",
          employmentType: row.employmentType || "full_time",
          existingIds,
        });

        const employeeId = instEmpId ?? personTemplate.institutionEmployeeId;
        const temporaryPassword = randomBytes(18).toString("base64url");

        const createdUser = await adminAuth.createUser({ email, password: temporaryPassword, displayName: row.fullName || undefined });
        try {
          await adminDb.collection("users").doc(createdUser.uid).set({
            uid: createdUser.uid,
            institutionId,
            institutionEmployeeId: employeeId,
            fullName: row.fullName,
            email,
            phone: row.phone ?? "",
            departmentId: row.department ?? null,
            role: row.role ?? "Employee",
            position: row.position ?? "",
            employmentType: row.employmentType ?? "",
            status: row.status ?? "active",
            createdAt: FieldValue.serverTimestamp(),
            lastActive: null,
          });
        } catch (inner) {
          // cleanup created auth user
          await adminAuth.deleteUser(createdUser.uid).catch(() => {});
          throw inner;
        }

        results.push({ rowId: row.rowId, status: "created", uid: createdUser.uid, temporaryPassword });
        createdCount += 1;

        // small delay could be added in large batches; omitted here
      } catch (rowErr) {
        console.error("Row import error", rowErr);
        results.push({ rowId: row.rowId, status: "error", reason: String(rowErr) });
      }
    }

    // update batch status
    await batchRef.update({ status: "created", createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdCount });

    // audit
    const auditRef = adminDb.collection("securityEvents").doc();
    await auditRef.set({
      eventId: auditRef.id,
      institutionId,
      uid: decoded.uid,
      type: "sensitive_action",
      source: "employees.import.confirm",
      details: { action: "bulk_import_create", batchId, createdCount },
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ batchId, createdCount, results });
  } catch (reason) {
    console.error("Unable to confirm import batch.", reason);
    return NextResponse.json({ error: "Unable to confirm import batch." }, { status: 500 });
  }
}
