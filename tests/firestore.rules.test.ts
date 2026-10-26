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
import { deleteField, doc, getDoc, setDoc, writeBatch } from "@firebase/firestore";

const projectId = "veqweris-rules-test";
const institutionA = "institution-a";
const institutionB = "institution-b";
const suspensionTestInstitution = "institution-suspension-test";
const ownerUid = "owner-a";
const ownerBUid = "owner-b";
const adminUid = "admin-a";
const managerUid = "manager-a";
const employeeUid = "employee-a";
const otherUid = "user-b";
const clinicianUid = "clinician-a";
const nurseUid = "nurse-a";
const suspensionTestUid = "employee-suspension-test";

let testEnv: RulesTestEnvironment;

function authenticatedContext(uid: string, permissionVersion = 1) {
  const principals: Record<string, { iid: string; tier: "Owner" | "Admin" | "Manager" | "Employee"; legacyRole?: string }> = {
    [ownerUid]: { iid: institutionA, tier: "Owner" },
    [ownerBUid]: { iid: institutionB, tier: "Owner" },
    [adminUid]: { iid: institutionA, tier: "Admin" },
    [managerUid]: { iid: institutionA, tier: "Manager" },
    [employeeUid]: { iid: institutionA, tier: "Employee" },
    [otherUid]: { iid: institutionB, tier: "Employee" },
    [clinicianUid]: { iid: institutionA, tier: "Employee", legacyRole: "Clinician" },
    [nurseUid]: { iid: institutionA, tier: "Employee", legacyRole: "Nurse" },
    [suspensionTestUid]: { iid: suspensionTestInstitution, tier: "Employee" },
  };
  const principal = principals[uid] ?? { iid: "untrusted", tier: "Employee" as const };
  return testEnv.authenticatedContext(uid, {
    ...principal,
    pt: "staff",
    pv: permissionVersion,
  });
}

async function assertPermissionDenied(operation: Promise<unknown>, message: string) {
  const result = await Promise.allSettled([operation]);
  assert.equal(result[0].status, "rejected", message);
  if (result[0].status === "rejected") {
    assert.equal((result[0].reason as { code?: string }).code, "permission-denied", message);
  }
}

function userData(uid: string, role: "Owner" | "Admin" | "Manager" | "Employee" | "Clinician" | "Nurse", institutionId: string, extra: Record<string, unknown> = {}) {
  return {
    uid,
    institutionId,
    fullName: uid,
    email: `${uid}@example.com`,
    role,
    departmentId: role === "Manager" || role === "Employee" ? "department-a" : null,
    lastActive: new Date(),
    status: "active",
    createdAt: new Date(),
    ...extra,
  };
}

function departmentData(departmentId: string, institutionId: string, headUserId: string | null = null) {
  return {
    departmentId,
    institutionId,
    name: departmentId,
    departmentCode: departmentId.toUpperCase(),
    headUserId,
    description: "Test department",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function taskData(taskId: string, institutionId: string, departmentId: string, assignedTo: string) {
  return {
    taskId,
    institutionId,
    departmentId,
    title: taskId,
    description: "Test task",
    assignedTo,
    assignedBy: ownerUid,
    priority: "medium",
    status: "todo",
    dueDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function plannerEventData(eventId: string, institutionId: string, departmentId: string | null, createdBy: string, attendees: string[] = []) {
  return {
    eventId,
    institutionId,
    departmentId,
    title: eventId,
    description: "Test event",
    startTime: new Date(),
    endTime: new Date(Date.now() + 3600000),
    location: "Test location",
    createdBy,
    attendees,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function conversationData(conversationId: string, institutionId: string, participantIds: string[], createdBy: string, type: "direct" | "department" | "institution_wide" = "direct", departmentId: string | null = null) {
  return { conversationId, institutionId, participantIds, createdBy, type, departmentId, lastMessagePreview: "", lastMessageAt: new Date(), createdAt: new Date() };
}

function messageData(messageId: string, conversationId: string, institutionId: string, senderId: string) {
  return { messageId, conversationId, institutionId, senderId, text: "Hello", type: "text", createdAt: new Date() };
}

async function seedData() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "institutions", institutionA), {
      institutionId: institutionA,
      name: "Institution A",
      country: "US",
      status: "active",
      planTier: "enterprise",
      createdAt: new Date(),
    });
    await setDoc(doc(db, "institutions", institutionB), {
      institutionId: institutionB,
      name: "Institution B",
      country: "GB",
      status: "active",
      planTier: "trial",
      createdAt: new Date(),
    });
    await setDoc(doc(db, "institutions", suspensionTestInstitution), {
      institutionId: suspensionTestInstitution,
      name: "Suspension Test",
      status: "active",
      planTier: "enterprise",
    });
    for (const [uid, role, institutionId] of [
      [ownerUid, "Owner", institutionA],
      [ownerBUid, "Owner", institutionB],
      [adminUid, "Admin", institutionA],
      [managerUid, "Manager", institutionA],
      [employeeUid, "Employee", institutionA],
      [otherUid, "Employee", institutionB],
      [clinicianUid, "Clinician", institutionA],
      [nurseUid, "Nurse", institutionA],
      [suspensionTestUid, "Employee", suspensionTestInstitution],
    ] as const) {
      await setDoc(doc(db, "users", uid), userData(uid, role, institutionId));
      await setDoc(doc(db, "memberships", uid), {
        institutionId,
        tier: role === "Owner" || role === "Admin" || role === "Manager" ? role : "Employee",
        roleIds: [],
        departmentIds: role === "Manager" ? ["department-a"] : [],
        unitIds: [],
        teamIds: [],
        locationIds: [],
        permissionVersion: 1,
        status: "active",
      });
    }
    await setDoc(doc(db, "portalAccounts", "external-a"), {
      institutionId: institutionA,
      principalType: "guardian",
      linkedEntityIds: ["student-a"],
      status: "active",
      invitedBy: ownerUid,
    });
    await setDoc(doc(db, "departments", "department-a"), departmentData("department-a", institutionA, managerUid));
    await setDoc(doc(db, "departments", "department-c"), departmentData("department-c", institutionA));
    await setDoc(doc(db, "departments", "department-b"), departmentData("department-b", institutionB, otherUid));
    await setDoc(doc(db, "tasks", "task-a"), taskData("task-a", institutionA, "department-a", employeeUid));
    await setDoc(doc(db, "tasks", "task-b"), taskData("task-b", institutionB, "department-b", otherUid));
    await setDoc(doc(db, "tasks", "task-suspension-test"), taskData("task-suspension-test", suspensionTestInstitution, "department-a", suspensionTestUid));
    await setDoc(doc(db, "plannerEvents", "event-a"), plannerEventData("event-a", institutionA, "department-a", managerUid, [employeeUid]));
    await setDoc(doc(db, "plannerEvents", "event-wide"), plannerEventData("event-wide", institutionA, null, ownerUid));
    await setDoc(doc(db, "plannerEvents", "event-other-department"), plannerEventData("event-other-department", institutionA, "department-c", ownerUid));
    await setDoc(doc(db, "plannerEvents", "event-b"), plannerEventData("event-b", institutionB, "department-b", otherUid, [otherUid]));
    await setDoc(doc(db, "clinicalRecords", "clinical-a"), {
      clinicalRecordId: "clinical-a", institutionId: institutionA, patientId: "patient-a",
      encounterId: "encounter-a", recordType: "note", summary: "restricted", sensitivity: "sensitive",
      specialtyId: "cardiology", authoredBy: clinicianUid, createdAt: new Date(),
    });
    await setDoc(doc(db, "clinicalRecords", "clinical-standard"), {
      clinicalRecordId: "clinical-standard", institutionId: institutionA, patientId: "patient-b",
      encounterId: "encounter-b", recordType: "note", summary: "standard", sensitivity: "standard",
      authoredBy: ownerUid, createdAt: new Date(),
    });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
  });
  await seedData();
});

after(async () => {
  await testEnv.cleanup();
});

test("authenticated user cannot read or write another institution's documents", async () => {
  const db = authenticatedContext(employeeUid).firestore();
  await assertFails(getDoc(doc(db, "institutions", institutionB)));
  await assertFails(setDoc(doc(db, "institutions", institutionB), { name: "blocked" }, { merge: true }));
  await assertFails(getDoc(doc(db, "users", otherUid)));
  await assertFails(setDoc(doc(db, "users", otherUid), { fullName: "blocked" }, { merge: true }));
});

test("authenticated Owner can read and write documents in their own institution", async () => {
  const db = authenticatedContext(ownerUid).firestore();
  await assertSucceeds(getDoc(doc(db, "institutions", institutionA)));
  await assertSucceeds(setDoc(doc(db, "institutions", institutionA), { name: "Updated Institution A" }, { merge: true }));
  await assertSucceeds(setDoc(doc(db, "users", ownerUid), { fullName: "Updated Owner" }, { merge: true }));
});

test("claims gate staff access and external principals remain outside staff collections", async () => {
  const noClaims = testEnv.authenticatedContext("missing-claims").firestore();
  await assertFails(getDoc(doc(noClaims, "institutions", institutionA)));

  const external = testEnv.authenticatedContext("external-a", {
    iid: institutionA,
    tier: "none",
    pt: "external",
    pv: 0,
  }).firestore();
  await assertSucceeds(getDoc(doc(external, "portalAccounts", "external-a")));
  await assertFails(getDoc(doc(external, "users", ownerUid)));
  await assertFails(getDoc(doc(external, "departments", "department-a")));
});

test("institution settings and their restricted audit trail are server-mediated", async () => {
  const ownerDb = authenticatedContext(ownerUid).firestore();
  const otherOwnerDb = authenticatedContext(ownerBUid).firestore();
  const unauthenticatedDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(ownerDb, "institutionSettings", institutionA, "sections", "profile")));
  await assertFails(setDoc(doc(ownerDb, "institutionSettings", institutionA, "sections", "profile"), {
    institutionId: institutionA,
    sectionId: "profile",
    values: { "profile.legalName": "Forged" },
    schemaVersion: 1,
  }));
  await assertFails(getDoc(doc(ownerDb, "institutionSettings", institutionA, "sections", "profile", "drafts", "draft-a")));
  await assertFails(getDoc(doc(ownerDb, "settingsAuditEvents", "audit-a")));
  await assertFails(getDoc(doc(otherOwnerDb, "institutionSettings", institutionA, "sections", "profile")));
  await assertFails(getDoc(doc(unauthenticatedDb, "settingsAuditEvents", "audit-a")));
});

test("direct Firestore access rejects stale claims, inactive memberships, and stale role tiers", async () => {
  const staleEmployeeDb = authenticatedContext(employeeUid).firestore();
  try {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "memberships", employeeUid), { permissionVersion: 2 }, { merge: true });
    });
    await assertPermissionDenied(getDoc(doc(staleEmployeeDb, "tasks", "task-a")), "Old permission versions must be rejected.");
    await assertSucceeds(getDoc(doc(authenticatedContext(employeeUid, 2).firestore(), "tasks", "task-a")));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "memberships", employeeUid), { status: "inactive" }, { merge: true });
    });
    await assertPermissionDenied(
      getDoc(doc(authenticatedContext(employeeUid, 2).firestore(), "tasks", "task-a")),
      "Inactive memberships must be rejected.",
    );

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "memberships", employeeUid), {
        status: "active",
        permissionVersion: 1,
      }, { merge: true });
      await setDoc(doc(context.firestore(), "memberships", adminUid), {
        tier: "Employee",
        permissionVersion: 2,
      }, { merge: true });
    });
    await assertPermissionDenied(
      getDoc(doc(authenticatedContext(adminUid).firestore(), "tasks", "task-a")),
      "A stale Admin-tier claim must be rejected.",
    );

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "memberships", adminUid), {
        tier: "Admin",
        permissionVersion: 1,
      }, { merge: true });
      await setDoc(doc(context.firestore(), "institutions", institutionA), {
        entitlement: { modules: [], features: [] },
      }, { merge: true });
    });
    await assertPermissionDenied(
      getDoc(doc(authenticatedContext(employeeUid).firestore(), "tasks", "task-a")),
      "Removing the task module entitlement must deny direct access.",
    );
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "institutions", institutionA), { entitlement: deleteField() }, { merge: true });
    });
    await assertSucceeds(getDoc(doc(authenticatedContext(employeeUid).firestore(), "tasks", "task-a")));
  } finally {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "memberships", employeeUid), {
        status: "active",
        permissionVersion: 1,
      }, { merge: true });
      await setDoc(doc(context.firestore(), "memberships", adminUid), {
        tier: "Admin",
        permissionVersion: 1,
      }, { merge: true });
      await setDoc(doc(context.firestore(), "institutions", institutionA), { entitlement: deleteField() }, { merge: true });
    });
  }
});

test("tenant owners cannot modify platform-owned institution state or access platform collections", async () => {
  const db = authenticatedContext(ownerUid).firestore();
  await assertFails(setDoc(doc(db, "institutions", institutionA), { planTier: "basic" }, { merge: true }));
  await assertFails(setDoc(doc(db, "institutions", institutionA), { relationship: "Internal" }, { merge: true }));
  await assertFails(setDoc(doc(db, "institutions", institutionA), { entitlement: { modules: ["school"] } }, { merge: true }));
  await assertFails(getDoc(doc(db, "platformOperators", ownerUid)));
  await assertFails(setDoc(doc(db, "platformSupportGrants", "forged"), { institutionId: institutionA }));
  await assertFails(setDoc(doc(db, "platformAuditEvents", "forged"), { institutionId: institutionA }));
  await assertFails(setDoc(doc(db, "platformBootstrap", "initial-owner"), { uid: ownerUid }));
  const attackerDb = authenticatedContext("attacker").firestore();
  await assertFails(setDoc(doc(attackerDb, "users", "attacker"), userData("attacker", "Owner", institutionA)));
});

test("suspended institutions lose Firestore operational access while active institutions retain it", async () => {
  const db = authenticatedContext(suspensionTestUid).firestore();
  await assertSucceeds(getDoc(doc(db, "tasks", "task-suspension-test")));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "institutions", suspensionTestInstitution), { status: "suspended" }, { merge: true });
  });
  await assertFails(getDoc(doc(db, "tasks", "task-suspension-test")));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "institutions", suspensionTestInstitution), { status: "active" }, { merge: true });
  });
  await assertSucceeds(getDoc(doc(db, "tasks", "task-suspension-test")));
});

test("tenant institution admins cannot self-assign a network trust state", async () => {
  const db = authenticatedContext(ownerUid).firestore();
  const profile = {
    institutionId: institutionA,
    institutionName: "Institution A",
    broadLocation: "North",
    selectedServices: ["coordination"],
    participation: "open",
    contactEnabled: true,
    trustState: "Registered",
    updatedAt: new Date().toISOString(),
  };
  await assertSucceeds(setDoc(doc(db, "networkProfiles", institutionA), profile));
  await assertFails(setDoc(doc(db, "networkProfiles", institutionA), { ...profile, trustState: "Enterprise Partner" }));
  await assertFails(setDoc(doc(db, "networkProfiles", institutionA), { ...profile, platformTrustState: "Verified" }));
  const basicDb = authenticatedContext(ownerBUid).firestore();
  await assertFails(setDoc(doc(basicDb, "networkProfiles", institutionB), { ...profile, institutionId: institutionB }));
});

test("authenticated user can always read their own user document", async () => {
  const db = authenticatedContext(employeeUid).firestore();
  await assertSucceeds(getDoc(doc(db, "users", employeeUid)));
});

test("users can update personal profile fields but cannot change authorization fields", async () => {
  const db = authenticatedContext(clinicianUid).firestore();
  const profileRef = doc(db, "users", clinicianUid);
  await assertSucceeds(setDoc(profileRef, {
    fullName: "Updated Clinician",
    email: "updated-clinician@example.com",
    phone: "555-0100",
    photoUrl: "https://example.com/profile.png",
    preferences: { theme: "dark" },
  }, { merge: true }));

  await assertFails(setDoc(profileRef, { status: "inactive" }, { merge: true }));
  await assertFails(setDoc(profileRef, { role: "Owner" }, { merge: true }));
  await assertFails(setDoc(profileRef, { departmentId: "department-c" }, { merge: true }));
  await assertFails(setDoc(profileRef, { assignedPatientIds: ["patient-b"] }, { merge: true }));
  await assertFails(setDoc(profileRef, { specialtyIds: ["oncology"] }, { merge: true }));
  await assertFails(setDoc(profileRef, { healthcarePermissions: ["highly_sensitive"] }, { merge: true }));
});

test("initial signup is blocked when the managed Basic plan cannot include one Owner", async () => {
  async function createOwnerSignup(uid: string, institutionId: string) {
    const db = authenticatedContext(uid).firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, "institutions", institutionId), {
      institutionId, createdBy: uid, name: "Signup institution", country: "Test",
      status: "active", planTier: "trial", createdAt: new Date(),
    });
    batch.set(doc(db, "users", uid), {
      uid, institutionId, role: "Owner", status: "active",
    });
    return batch.commit();
  }

  await assertSucceeds(createOwnerSignup("signup-default-owner", "signup-default-institution"));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "platformPlanCatalog", "basic"), {
      planId: "basic", status: "active", limits: { maxUsers: 0 },
    });
  });
  await assertFails(createOwnerSignup("signup-no-user-capacity", "signup-no-capacity-institution"));
});

test("Manager and Employee cannot modify another user in their institution", async () => {
  const managerDb = authenticatedContext(managerUid).firestore();
  const employeeDb = authenticatedContext(employeeUid).firestore();
  await assertFails(setDoc(doc(managerDb, "users", employeeUid), { fullName: "blocked" }, { merge: true }));
  await assertFails(setDoc(doc(employeeDb, "users", managerUid), { fullName: "blocked" }, { merge: true }));
});

test("Owner and Admin can edit another profile but cannot change membership status directly", async () => {
  const ownerDb = authenticatedContext(ownerUid).firestore();
  const adminDb = authenticatedContext(adminUid).firestore();
  await assertSucceeds(setDoc(doc(ownerDb, "users", employeeUid), { fullName: "Updated employee" }, { merge: true }));
  await assertSucceeds(setDoc(doc(adminDb, "users", managerUid), { fullName: "Updated manager" }, { merge: true }));
  await assertFails(setDoc(doc(ownerDb, "users", employeeUid), { status: "inactive" }, { merge: true }));
  await assertFails(setDoc(doc(adminDb, "users", managerUid), { status: "inactive" }, { merge: true }));
});

test("healthcare access enforces assignment, specialty, sensitivity, and institution", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", clinicianUid), userData(clinicianUid, "Clinician", institutionA, {
      assignedPatientIds: ["patient-a"], specialtyId: "cardiology", healthcarePermissions: ["sensitive"],
    }));
    await setDoc(doc(db, "users", nurseUid), userData(nurseUid, "Nurse", institutionA, {
      assignedPatientIds: ["patient-b"], specialtyId: "general",
    }));
  });
  await assertSucceeds(getDoc(doc(authenticatedContext(clinicianUid).firestore(), "clinicalRecords", "clinical-a")));
  await assertFails(getDoc(doc(authenticatedContext(nurseUid).firestore(), "clinicalRecords", "clinical-a")));
  await assertFails(getDoc(doc(authenticatedContext(employeeUid).firestore(), "clinicalRecords", "clinical-standard")));
  await assertFails(getDoc(doc(authenticatedContext(otherUid).firestore(), "clinicalRecords", "clinical-standard")));
});

test("unauthenticated requests cannot read or write anything", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "institutions", institutionA)));
  await assertFails(setDoc(doc(db, "institutions", institutionA), { name: "blocked" }, { merge: true }));
  await assertFails(getDoc(doc(db, "users", ownerUid)));
  await assertFails(setDoc(doc(db, "users", ownerUid), { fullName: "blocked" }, { merge: true }));
});

test("client security events are self-attributed and limited to safe activity", async () => {
  const db = authenticatedContext(employeeUid).firestore();
  const validEvent = {
    eventId: "employee-login-event",
    institutionId: institutionA,
    uid: employeeUid,
    type: "login",
    source: "login_form",
    details: {},
    createdAt: new Date(),
  };
  await assertSucceeds(setDoc(doc(db, "securityEvents", validEvent.eventId), validEvent));
  await assertFails(setDoc(doc(db, "securityEvents", "forged-actor"), {
    ...validEvent, eventId: "forged-actor", uid: ownerUid,
  }));
  await assertFails(setDoc(doc(db, "securityEvents", "forged-sensitive-action"), {
    ...validEvent, eventId: "forged-sensitive-action", type: "sensitive_action", source: "payments.refund.requested",
  }));
  await assertFails(setDoc(doc(db, "securityEvents", "unexpected-fields"), {
    ...validEvent, eventId: "unexpected-fields", institutionId: institutionB, payload: { secret: true },
  }));
});

test("client users cannot create or mutate server-managed bills and refunds", async () => {
  const ownerDb = authenticatedContext(ownerUid).firestore();
  await assertFails(setDoc(doc(ownerDb, "bills", "client-created-bill"), {
    billId: "client-created-bill", institutionId: institutionA, total: 10, currency: "USD", status: "OPEN",
  }));
  await assertFails(setDoc(doc(ownerDb, "refunds", "client-created-refund"), {
    refundId: "client-created-refund", institutionId: institutionA, requestedBy: ownerUid, amount: 10,
  }));
});

test("cross-institution department and task access is blocked", async () => {
  const db = authenticatedContext(employeeUid).firestore();
  await assertFails(getDoc(doc(db, "departments", "department-b")));
  await assertFails(setDoc(doc(db, "departments", "department-b"), { name: "blocked" }, { merge: true }));
  await assertFails(getDoc(doc(db, "tasks", "task-b")));
  await assertFails(setDoc(doc(db, "tasks", "task-b"), { title: "blocked" }, { merge: true }));
});

test("Employee cannot create a department", async () => {
  const db = authenticatedContext(employeeUid).firestore();
  await assertFails(setDoc(doc(db, "departments", "employee-department"), departmentData("employee-department", institutionA)));
});

test("department creation is restricted to the server-side capacity boundary", async () => {
  const ownerDb = authenticatedContext(ownerUid).firestore();
  const adminDb = authenticatedContext(adminUid).firestore();
  await assertFails(setDoc(doc(ownerDb, "departments", "owner-department"), departmentData("owner-department", institutionA)));
  await assertFails(setDoc(doc(adminDb, "departments", "admin-department"), departmentData("admin-department", institutionA)));
});

test("integration configuration writes are restricted to the server-side capacity boundary", async () => {
  const ownerDb = authenticatedContext(ownerUid).firestore();
  const adminDb = authenticatedContext(adminUid).firestore();
  const integration = { integrationId: "integration-a", institutionId: institutionA, provider: "test" };
  await assertFails(setDoc(doc(ownerDb, "integrations", "integration-a"), integration));
  await assertFails(setDoc(doc(adminDb, "integrations", "integration-a"), integration));
  await assertFails(setDoc(doc(ownerDb, "integrationCredentials", "credential-a"), integration));
});

test("Manager can update their own department but not another department", async () => {
  const db = authenticatedContext(managerUid).firestore();
  await assertSucceeds(setDoc(doc(db, "departments", "department-a"), { description: "Updated by manager" }, { merge: true }));
  await assertFails(setDoc(doc(db, "departments", "department-c"), { description: "Blocked" }, { merge: true }));
});

test("Employee can update only the status of their assigned task", async () => {
  const db = authenticatedContext(employeeUid).firestore();
  await assertSucceeds(setDoc(doc(db, "tasks", "task-a"), { status: "review" }, { merge: true }));
  await assertFails(setDoc(doc(db, "tasks", "task-a"), { assignedTo: managerUid }, { merge: true }));
  await assertFails(setDoc(doc(db, "tasks", "task-a"), { priority: "high" }, { merge: true }));
});

test("Manager can create tasks only within their own department", async () => {
  const db = authenticatedContext(managerUid).firestore();
  await assertSucceeds(setDoc(doc(db, "tasks", "manager-task"), taskData("manager-task", institutionA, "department-a", employeeUid)));
  await assertFails(setDoc(doc(db, "tasks", "outside-task"), taskData("outside-task", institutionA, "department-b", employeeUid)));
});

test("unauthenticated requests to departments and tasks are blocked", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "departments", "department-a")));
  await assertFails(setDoc(doc(db, "departments", "unauthenticated-department"), departmentData("unauthenticated-department", institutionA)));
  await assertFails(getDoc(doc(db, "tasks", "task-a")));
  await assertFails(setDoc(doc(db, "tasks", "unauthenticated-task"), taskData("unauthenticated-task", institutionA, "department-a", employeeUid)));
});

test("cross-institution planner event access is blocked", async () => {
  const db = authenticatedContext(employeeUid).firestore();
  await assertFails(getDoc(doc(db, "plannerEvents", "event-b")));
  await assertFails(setDoc(doc(db, "plannerEvents", "event-b"), { title: "blocked" }, { merge: true }));
});

test("Employee cannot create a planner event", async () => {
  const db = authenticatedContext(employeeUid).firestore();
  await assertFails(setDoc(doc(db, "plannerEvents", "employee-event"), plannerEventData("employee-event", institutionA, null, employeeUid)));
});

test("Owner and Admin can create institution-wide planner events", async () => {
  const ownerDb = authenticatedContext(ownerUid).firestore();
  const adminDb = authenticatedContext(adminUid).firestore();
  await assertSucceeds(setDoc(doc(ownerDb, "plannerEvents", "owner-event"), plannerEventData("owner-event", institutionA, null, ownerUid)));
  await assertSucceeds(setDoc(doc(adminDb, "plannerEvents", "admin-event"), plannerEventData("admin-event", institutionA, null, adminUid)));
});

test("Manager can create only in their own planner department", async () => {
  const db = authenticatedContext(managerUid).firestore();
  await assertSucceeds(setDoc(doc(db, "plannerEvents", "manager-event"), plannerEventData("manager-event", institutionA, "department-a", managerUid)));
  await assertFails(setDoc(doc(db, "plannerEvents", "manager-outside-event"), plannerEventData("manager-outside-event", institutionA, "department-c", managerUid)));
});

test("Employee planner reads are limited to attendees and institution-wide events", async () => {
  const db = authenticatedContext(employeeUid).firestore();
  await assertSucceeds(getDoc(doc(db, "plannerEvents", "event-a")));
  await assertSucceeds(getDoc(doc(db, "plannerEvents", "event-wide")));
  await assertFails(getDoc(doc(db, "plannerEvents", "event-other-department")));
});

test("Unauthenticated planner event access is blocked", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "plannerEvents", "event-wide")));
  await assertFails(setDoc(doc(db, "plannerEvents", "unauthenticated-event"), plannerEventData("unauthenticated-event", institutionA, null, ownerUid)));
});

test("conversation participants can read their own institution conversation", async () => {
  const adminDb = authenticatedContext(adminUid).firestore();
  const ownerDb = authenticatedContext(ownerUid).firestore();
  const employeeDb = authenticatedContext(employeeUid).firestore();
  await assertSucceeds(setDoc(doc(adminDb, "conversations", "conversation-a"), conversationData("conversation-a", institutionA, [ownerUid, adminUid], adminUid)));
  await assertSucceeds(getDoc(doc(adminDb, "conversations", "conversation-a")));
  await assertSucceeds(setDoc(doc(ownerDb, "conversations", "institution-wide"), conversationData("institution-wide", institutionA, [], ownerUid, "institution_wide")));
  await assertSucceeds(getDoc(doc(employeeDb, "conversations", "institution-wide")));
  await assertFails(setDoc(doc(employeeDb, "conversations", "institution-wide", "messages", "employee-message"), messageData("employee-message", "institution-wide", institutionA, employeeUid)));
});

test("conversation participants cannot cross institution boundaries", async () => {
  const db = authenticatedContext(employeeUid).firestore();
  await assertFails(getDoc(doc(db, "conversations", "conversation-a")));
});

test("non-participants cannot read a direct conversation", async () => {
  const db = authenticatedContext(managerUid).firestore();
  await assertFails(getDoc(doc(db, "conversations", "conversation-a")));
});

test("a signed-in user can create a conversation including themselves", async () => {
  const db = authenticatedContext(employeeUid).firestore();
  await assertSucceeds(setDoc(doc(db, "conversations", "conversation-employee"), conversationData("conversation-employee", institutionA, [employeeUid, managerUid], employeeUid)));
});

test("users cannot create a conversation in another institution", async () => {
  const db = authenticatedContext(employeeUid).firestore();
  await assertFails(setDoc(doc(db, "conversations", "conversation-cross"), conversationData("conversation-cross", institutionB, [employeeUid, otherUid], employeeUid)));
});

test("conversation participants can send messages as themselves", async () => {
  const db = authenticatedContext(adminUid).firestore();
  await assertSucceeds(setDoc(doc(db, "conversations", "conversation-a", "messages", "message-a"), messageData("message-a", "conversation-a", institutionA, adminUid)));
  await assertFails(setDoc(doc(db, "conversations", "conversation-a", "messages", "message-forged"), messageData("message-forged", "conversation-a", institutionA, ownerUid)));
});

test("department conversations are limited to the matching department", async () => {
  const managerDb = authenticatedContext(managerUid).firestore();
  const employeeDb = authenticatedContext(employeeUid).firestore();
  const otherDb = authenticatedContext(otherUid).firestore();
  await assertSucceeds(setDoc(doc(managerDb, "conversations", "department-conversation"), conversationData("department-conversation", institutionA, [managerUid], managerUid, "department", "department-a")));
  await assertSucceeds(getDoc(doc(employeeDb, "conversations", "department-conversation")));
  await assertFails(getDoc(doc(otherDb, "conversations", "department-conversation")));
  await assertFails(setDoc(doc(employeeDb, "conversations", "department-conversation", "messages", "employee-message"), messageData("employee-message", "department-conversation", institutionA, employeeUid)));
});
