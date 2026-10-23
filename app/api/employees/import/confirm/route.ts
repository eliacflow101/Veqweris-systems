import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { createPeopleDirectoryEntry } from "@/lib/people-engine";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { withInstitutionCapacity } from "@/lib/platform/capacity";
import { requireInstitutionModuleEntitlement } from "@/lib/platform/tenant-entitlements";
import type { UserRole } from "@/lib/firebase/models";

const invitedRoles: UserRole[] = ["Admin", "Manager", "Employee"];
const IMPORT_LEASE_MS = 5 * 60 * 1000;

type ImportRow = {
  rowId?: string;
  allowed?: boolean;
  officialEmail?: string;
  fullName?: string;
  institutionEmployeeId?: string;
  department?: string | null;
  role?: UserRole;
  position?: string;
  employmentType?: string;
  phone?: string;
};

type ImportResult = {
  rowId: string;
  status: "created" | "failed" | "recoverable" | "skipped";
  uid?: string;
  reason?: string;
  credentialRecoveryRequired?: boolean;
};

function deterministicUid(batchId: string, rowId: string) {
  return `imp_${createHash("sha256").update(`${batchId}:${rowId}`).digest("hex").slice(0, 24)}`;
}

function authUserMissing(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    && String(error.code) === "auth/user-not-found";
}

async function persistRowResult(
  batchRef: DocumentReference,
  claimId: string,
  existing: ImportResult[],
  result: ImportResult,
) {
  const db = adminDb!;
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(batchRef);
    if (!snapshot.exists || snapshot.get("processingClaimId") !== claimId) throw new Error("IMPORT_CLAIM_LOST");
    const current = (snapshot.get("results") as ImportResult[] | undefined) ?? existing;
    const next = [...current.filter((item) => item.rowId !== result.rowId), result];
    transaction.update(batchRef, {
      results: next,
      processingLeaseUntil: Date.now() + IMPORT_LEASE_MS,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return next;
  });
}

export async function POST(request: Request) {
  if (!adminAuth || !adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
  let batchRef: FirebaseFirestore.DocumentReference | undefined;
  let claimId: string | undefined;

  try {
    const sessionToken = await getSessionToken(request);
    if (!sessionToken) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const decoded = await verifyActiveSession(sessionToken);
    const userSnapshot = await adminDb.collection("users").doc(decoded.uid).get();
    const userData = userSnapshot.data();
    if (!userSnapshot.exists || !userData || userData.status !== "active"
      || !userData.institutionId || !["Owner", "Admin"].includes(userData.role)) {
      return NextResponse.json({ error: "Only active institution Owners and Admins can confirm imports." }, { status: 403 });
    }
    const institutionId = String(userData.institutionId);
    await requireInstitutionModuleEntitlement(institutionId, "employees");

    const body = await request.json() as { batchId?: string };
    if (!body.batchId) return NextResponse.json({ error: "batchId is required." }, { status: 400 });
    batchRef = adminDb.collection("bulkImportBatches").doc(body.batchId);
    const newClaimId = randomUUID();
    const claimed = await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(batchRef!);
      if (!snapshot.exists || snapshot.get("institutionId") !== institutionId) return { missing: true as const };
      const batch = snapshot.data()!;
      const previousResults = (batch.results as ImportResult[] | undefined) ?? [];
      if (["completed", "created"].includes(String(batch.status)) && previousResults.length) {
        return { completed: true as const, results: previousResults, createdCount: Number(batch.createdCount ?? 0) };
      }
      const leaseUntil = Number(batch.processingLeaseUntil ?? 0);
      if (batch.status === "processing" && leaseUntil > Date.now()) return { busy: true as const };
      if (!["pending_review", "partial", "created", "processing"].includes(String(batch.status))) {
        return { invalid: true as const };
      }
      claimId = newClaimId;
      transaction.update(batchRef!, {
        status: "processing",
        processingClaimId: newClaimId,
        processingLeaseUntil: Date.now() + IMPORT_LEASE_MS,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        rows: (batch.rows ?? []) as ImportRow[],
        results: previousResults,
      };
    });
    if ("missing" in claimed) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
    if ("completed" in claimed) return NextResponse.json({ batchId: body.batchId, createdCount: claimed.createdCount, results: claimed.results });
    if ("busy" in claimed) return NextResponse.json({ error: "Import batch is already being processed." }, { status: 409 });
    if ("invalid" in claimed) return NextResponse.json({ error: "Import batch is not available for confirmation." }, { status: 409 });

    let results = claimed.results;
    const responseSecrets = new Map<string, string>();
    for (let index = 0; index < claimed.rows.length; index += 1) {
      const row = claimed.rows[index];
      const rowId = typeof row.rowId === "string" && row.rowId ? row.rowId : `row-${index}`;
      if (results.some((result) => result.rowId === rowId && ["created", "skipped"].includes(result.status))) continue;
      if (!row.allowed) {
        results = await persistRowResult(batchRef, claimId!, results, { rowId, status: "skipped", reason: "Validation failed or row was not approved." });
        continue;
      }

      const email = String(row.officialEmail ?? "").trim().toLowerCase();
      const fullName = String(row.fullName ?? "").trim();
      const role = row.role;
      const employeeUid = deterministicUid(body.batchId, rowId);
      const cleanupRef = adminDb.collection("authCleanupTasks").doc(employeeUid);
      let createdAuth = false;
      let profileCreated = false;
      let temporaryPassword: string | undefined;

      try {
        if (!email || !fullName || !role || !invitedRoles.includes(role)) {
          throw new Error("Import row has an invalid name, email, or role.");
        }
        const employeeRef = adminDb.collection("users").doc(employeeUid);
        const existingProfile = await employeeRef.get();
        if (existingProfile.exists) {
          const existing = existingProfile.data()!;
          if (existing.institutionId !== institutionId || existing.status !== "active" || existing.email !== email) {
            throw new Error("Existing employee account does not match the active institution membership.");
          }
          await cleanupRef.delete();
          results = await persistRowResult(batchRef, claimId!, results, { rowId, status: "created", uid: employeeUid, credentialRecoveryRequired: true });
          continue;
        }

        const cleanupTask = await cleanupRef.get();
        if (cleanupTask.exists) {
          try {
            await adminAuth.deleteUser(employeeUid);
            await cleanupRef.delete();
          } catch (cleanupError) {
            if (!authUserMissing(cleanupError)) throw cleanupError;
            await cleanupRef.delete();
          }
        }

        const existingEmail = await adminDb.collection("users")
          .where("institutionId", "==", institutionId).where("email", "==", email).limit(1).get();
        if (!existingEmail.empty) {
          results = await persistRowResult(batchRef, claimId!, results, { rowId, status: "skipped", reason: "An active institution membership already uses this email." });
          continue;
        }
        const authByEmail = await adminAuth.getUserByEmail(email).catch((error: unknown) => {
          if (authUserMissing(error)) return null;
          if (typeof error === "object" && error !== null && "code" in error && String(error.code) === "auth/user-not-found") return null;
          throw error;
        });
        if (authByEmail && authByEmail.uid !== employeeUid) {
          results = await persistRowResult(batchRef, claimId!, results, { rowId, status: "skipped", reason: "An Authentication account already exists for this email." });
          continue;
        }

        let authUser = await adminAuth.getUser(employeeUid).catch((error: unknown) => {
          if (authUserMissing(error)) return null;
          throw error;
        });
        if (!authUser) {
          temporaryPassword = randomBytes(18).toString("base64url");
          authUser = await adminAuth.createUser({
            uid: employeeUid,
            email,
            password: temporaryPassword,
            displayName: fullName,
          });
          createdAuth = true;
        } else if (authUser.email?.toLowerCase() !== email) {
          throw new Error("A recoverable Authentication account has a different email.");
        }

        const departmentId = row.department?.trim() || null;
        if (departmentId) {
          const department = await adminDb.collection("departments").doc(departmentId).get();
          if (!department.exists || department.get("institutionId") !== institutionId) {
            throw new Error("The selected department is outside the active institution.");
          }
        }
        const template = createPeopleDirectoryEntry({
          institutionId,
          fullName,
          email,
          departmentId,
          role,
          position: row.position ?? "",
          employmentType: row.employmentType ?? "full_time",
          existingIds: row.institutionEmployeeId ? [] : claimed.rows.slice(0, index + 1).map((priorRow) => String(priorRow.rowId ?? "row")),
        });
        const employeeId = row.institutionEmployeeId?.trim() || template.institutionEmployeeId;
        await withInstitutionCapacity({
          db: adminDb,
          institutionId,
          limit: "maxUsers",
          amount: 1,
          idempotencyRef: employeeRef,
          duplicate: (snapshot) => {
            if (snapshot.get("institutionId") !== institutionId || snapshot.get("status") !== "active") {
              throw new Error("Existing employee membership is not active in this institution.");
            }
            return undefined;
          },
          write: (transaction) => transaction.create(employeeRef, {
            uid: employeeUid,
            institutionId,
            institutionEmployeeId: employeeId,
            fullName,
            email,
            phone: row.phone ?? "",
            departmentId,
            role,
            position: row.position ?? "",
            employmentType: row.employmentType ?? "full_time",
            status: "active",
            createdAt: FieldValue.serverTimestamp(),
            lastActive: null,
          }),
        });
        profileCreated = true;
        await cleanupRef.delete();
        if (temporaryPassword) responseSecrets.set(rowId, temporaryPassword);
        results = await persistRowResult(batchRef, claimId!, results, {
          rowId,
          status: "created",
          uid: employeeUid,
          ...(!createdAuth ? { credentialRecoveryRequired: true } : {}),
        });
      } catch (rowError) {
        let status: ImportResult["status"] = "failed";
        let reason = rowError instanceof Error ? rowError.message : "Employee row could not be imported.";
        const errorCode = typeof rowError === "object" && rowError !== null && "code" in rowError ? String(rowError.code) : "";
        if (errorCode === "PLAN_LIMIT_EXCEEDED:maxUsers" || reason.startsWith("PLAN_LIMIT_EXCEEDED")) {
          reason = "The institution has reached its user plan limit.";
        }
        if (profileCreated) {
          status = "recoverable";
          reason = "Employee membership was created but import progress needs recovery; retry the batch.";
        } else if (createdAuth) {
          try {
            await adminAuth.deleteUser(employeeUid);
          } catch (cleanupError) {
            if (authUserMissing(cleanupError)) {
              status = "failed";
            } else {
              status = "recoverable";
              reason = "Authentication cleanup failed; retry this import to recover the incomplete account.";
              await cleanupRef.set({
                uid: employeeUid,
                institutionId,
                batchId: body.batchId,
                rowId,
                email,
                status: "pending_cleanup",
                lastError: cleanupError instanceof Error ? cleanupError.message : "Authentication cleanup failed.",
                updatedAt: FieldValue.serverTimestamp(),
              }, { merge: true }).catch((recordError) => {
                console.error("Unable to persist the Auth cleanup task; the batch row remains recoverable by deterministic UID.", recordError);
              });
            }
          }
        } else {
          const authAccount = await adminAuth.getUser(employeeUid).catch(() => null);
          if (authAccount && !(await adminDb.collection("users").doc(employeeUid).get()).exists) {
            status = "recoverable";
            reason = "Authentication account exists without an active institution membership; retry to recover it.";
          }
        }
        console.error("Employee import row failed.", { batchId: body.batchId, rowId, error: rowError });
        results = await persistRowResult(batchRef, claimId!, results, { rowId, status, reason, ...(status === "recoverable" ? { uid: employeeUid } : {}) });
      }
    }

    const counts = {
      createdCount: results.filter((result) => result.status === "created").length,
      failedCount: results.filter((result) => result.status === "failed").length,
      recoverableCount: results.filter((result) => result.status === "recoverable").length,
      skippedCount: results.filter((result) => result.status === "skipped").length,
    };
    const finalStatus = counts.failedCount || counts.recoverableCount ? "partial" : "completed";
    const auditRef = adminDb.collection("securityEvents").doc(`import_${body.batchId}_${claimId}`);
    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(batchRef!);
      if (!snapshot.exists || snapshot.get("processingClaimId") !== claimId) throw new Error("IMPORT_CLAIM_LOST");
      transaction.update(batchRef!, {
        status: finalStatus,
        ...counts,
        results,
        processingLeaseUntil: 0,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(auditRef, {
        eventId: auditRef.id,
        institutionId,
        uid: decoded.uid,
        type: "sensitive_action",
        source: "employees.import.confirm",
        details: { action: "bulk_import_create", batchId: body.batchId, ...counts, status: finalStatus },
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    return NextResponse.json({
      batchId: body.batchId,
      status: finalStatus,
      ...counts,
      results: results.map((result) => ({
        ...result,
        ...(responseSecrets.has(result.rowId) ? { temporaryPassword: responseSecrets.get(result.rowId) } : {}),
      })),
    });
  } catch (reason) {
    if (batchRef && claimId && adminDb) {
      await adminDb.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(batchRef!);
        if (snapshot.exists && snapshot.get("processingClaimId") === claimId) {
          transaction.update(batchRef!, {
            status: "partial",
            processingLeaseUntil: Date.now(),
            lastProcessingError: reason instanceof Error ? reason.message : "Import processing failed.",
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }).catch((updateError) => console.error("Unable to persist import recovery state.", updateError));
    }
    console.error("Unable to confirm import batch.", reason);
    const message = reason instanceof Error ? reason.message : "";
    const status = message === "IMPORT_IN_PROGRESS" ? 409
      : message === "FORBIDDEN" ? 403
        : message.includes("signed in") || message.includes("Session") ? 401 : 500;
    return NextResponse.json({ error: status === 500 ? "Unable to confirm import batch." : message }, { status });
  }
}
