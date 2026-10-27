import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "@firebase/firestore";

const projectId = "demo-veqweris-security-center-rules";
const institutionA = "security-rules-institution-a";
const institutionB = "security-rules-institution-b";
const ownerUid = "security-rules-owner-a";
const employeeUid = "security-rules-employee-a";
const ownerBUid = "security-rules-owner-b";

let testEnv: RulesTestEnvironment;

function context(uid: string, institutionId: string, tier: "Owner" | "Employee") {
  return testEnv.authenticatedContext(uid, { pt: "staff", iid: institutionId, tier, pv: 1 }).firestore();
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
  });
  await testEnv.withSecurityRulesDisabled(async (adminContext) => {
    const db = adminContext.firestore();
    for (const institutionId of [institutionA, institutionB]) {
      await setDoc(doc(db, "institutions", institutionId), {
        institutionId,
        status: "active",
        planTier: "enterprise",
      });
    }
    for (const [uid, institutionId, tier] of [
      [ownerUid, institutionA, "Owner"],
      [employeeUid, institutionA, "Employee"],
      [ownerBUid, institutionB, "Owner"],
    ]) {
      await setDoc(doc(db, "memberships", uid), {
        institutionId,
        tier,
        status: "active",
        permissionVersion: 1,
      });
      await setDoc(doc(db, "effectivePermissions", uid), {
        institutionId,
        version: 1,
        permissionKeys: ["documents.read", "security.center.read"],
      });
    }
    await setDoc(doc(db, "documents", "verified-clean"), {
      documentId: "verified-clean",
      institutionId: institutionA,
      uploadedBy: ownerUid,
      departmentId: "department-x",
      status: "AVAILABLE",
      scanStatus: "CLEAN",
      size: 12,
      storagePath: `documents/${institutionA}/verified-clean.pdf`,
    });
    await setDoc(doc(db, "documents", "legacy-unverified"), {
      documentId: "legacy-unverified",
      institutionId: institutionA,
      uploadedBy: ownerUid,
      departmentId: "department-x",
      status: "AVAILABLE",
      size: 12,
      storagePath: `documents/${institutionA}/legacy.pdf`,
    });
    await setDoc(doc(db, "securityIncidents", "incident-a"), {
      incidentId: "incident-a",
      institutionId: institutionA,
      status: "draft",
      version: 1,
    });
    await setDoc(doc(db, "securityIncidents/incident-a/timeline", "event-a"), {
      institutionId: institutionA,
      incidentId: "incident-a",
    });
  });
});

after(async () => testEnv.cleanup());

test("direct Security Center incident, audit, timeline, and idempotency access is denied", async () => {
  const ownerDb = context(ownerUid, institutionA, "Owner");
  const otherTenantDb = context(ownerBUid, institutionB, "Owner");
  const anonymousDb = testEnv.unauthenticatedContext().firestore();

  await assertFails(getDoc(doc(ownerDb, "securityIncidents", "incident-a")));
  await assertFails(getDoc(doc(otherTenantDb, "securityIncidents", "incident-a")));
  await assertFails(getDoc(doc(anonymousDb, "securityIncidents", "incident-a")));
  await assertFails(setDoc(doc(ownerDb, "securityIncidents", "forged"), { institutionId: institutionA }));
  await assertFails(updateDoc(doc(ownerDb, "securityIncidents", "incident-a"), { status: "closed" }));
  await assertFails(deleteDoc(doc(ownerDb, "securityIncidents", "incident-a")));
  await assertFails(getDoc(doc(ownerDb, "securityIncidents/incident-a/timeline", "event-a")));
  await assertFails(setDoc(doc(ownerDb, "securityAuditEvents", "forged"), { institutionId: institutionA }));
  await assertFails(setDoc(doc(ownerDb, "securityIdempotency", "forged"), { institutionId: institutionA }));
});

test("document records are server-only and direct reads or writes are denied", async () => {
  const ownerDb = context(ownerUid, institutionA, "Owner");
  const employeeDb = context(employeeUid, institutionA, "Employee");
  const anonymousDb = testEnv.unauthenticatedContext().firestore();

  await assertFails(getDoc(doc(ownerDb, "documents", "verified-clean")));
  await assertFails(getDoc(doc(employeeDb, "documents", "verified-clean")));
  await assertFails(getDoc(doc(ownerDb, "documents", "legacy-unverified")));
  await assertFails(getDoc(doc(anonymousDb, "documents", "verified-clean")));
  await assertFails(setDoc(doc(ownerDb, "documents", "client-created"), {
    documentId: "client-created",
    institutionId: institutionA,
    uploadedBy: ownerUid,
    status: "AVAILABLE",
    scanStatus: "CLEAN",
    storagePath: `documents/${institutionA}/forged.pdf`,
    size: 12,
  }));
  await assertFails(updateDoc(doc(ownerDb, "documents", "verified-clean"), { status: "FAILED" }));
  await assertFails(deleteDoc(doc(ownerDb, "documents", "verified-clean")));
});
