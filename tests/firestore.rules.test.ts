import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

const projectId = "veqweris-rules-test";
const institutionA = "institution-a";
const institutionB = "institution-b";
const ownerUid = "owner-a";
const adminUid = "admin-a";
const managerUid = "manager-a";
const employeeUid = "employee-a";
const otherUid = "user-b";

let testEnv: RulesTestEnvironment;

function userData(uid: string, role: "Owner" | "Admin" | "Manager" | "Employee", institutionId: string) {
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
      planTier: "trial",
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
    for (const [uid, role, institutionId] of [
      [ownerUid, "Owner", institutionA],
      [adminUid, "Admin", institutionA],
      [managerUid, "Manager", institutionA],
      [employeeUid, "Employee", institutionA],
      [otherUid, "Employee", institutionB],
    ] as const) {
      await setDoc(doc(db, "users", uid), userData(uid, role, institutionId));
    }
    await setDoc(doc(db, "departments", "department-a"), departmentData("department-a", institutionA, managerUid));
    await setDoc(doc(db, "departments", "department-c"), departmentData("department-c", institutionA));
    await setDoc(doc(db, "departments", "department-b"), departmentData("department-b", institutionB, otherUid));
    await setDoc(doc(db, "tasks", "task-a"), taskData("task-a", institutionA, "department-a", employeeUid));
    await setDoc(doc(db, "tasks", "task-b"), taskData("task-b", institutionB, "department-b", otherUid));
    await setDoc(doc(db, "plannerEvents", "event-a"), plannerEventData("event-a", institutionA, "department-a", managerUid, [employeeUid]));
    await setDoc(doc(db, "plannerEvents", "event-wide"), plannerEventData("event-wide", institutionA, null, ownerUid));
    await setDoc(doc(db, "plannerEvents", "event-other-department"), plannerEventData("event-other-department", institutionA, "department-c", ownerUid));
    await setDoc(doc(db, "plannerEvents", "event-b"), plannerEventData("event-b", institutionB, "department-b", otherUid, [otherUid]));
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
  const db = testEnv.authenticatedContext(employeeUid).firestore();
  await assertFails(getDoc(doc(db, "institutions", institutionB)));
  await assertFails(setDoc(doc(db, "institutions", institutionB), { name: "blocked" }, { merge: true }));
  await assertFails(getDoc(doc(db, "users", otherUid)));
  await assertFails(setDoc(doc(db, "users", otherUid), { fullName: "blocked" }, { merge: true }));
});

test("authenticated Owner can read and write documents in their own institution", async () => {
  const db = testEnv.authenticatedContext(ownerUid).firestore();
  await assertSucceeds(getDoc(doc(db, "institutions", institutionA)));
  await assertSucceeds(setDoc(doc(db, "institutions", institutionA), { name: "Updated Institution A" }, { merge: true }));
  await assertSucceeds(setDoc(doc(db, "users", ownerUid), { fullName: "Updated Owner" }, { merge: true }));
});

test("authenticated user can always read their own user document", async () => {
  const db = testEnv.authenticatedContext(employeeUid).firestore();
  await assertSucceeds(getDoc(doc(db, "users", employeeUid)));
});

test("Manager and Employee cannot modify another user in their institution", async () => {
  const managerDb = testEnv.authenticatedContext(managerUid).firestore();
  const employeeDb = testEnv.authenticatedContext(employeeUid).firestore();
  await assertFails(setDoc(doc(managerDb, "users", employeeUid), { fullName: "blocked" }, { merge: true }));
  await assertFails(setDoc(doc(employeeDb, "users", managerUid), { fullName: "blocked" }, { merge: true }));
});

test("Owner and Admin can modify another user in their institution", async () => {
  const ownerDb = testEnv.authenticatedContext(ownerUid).firestore();
  const adminDb = testEnv.authenticatedContext(adminUid).firestore();
  await assertSucceeds(setDoc(doc(ownerDb, "users", employeeUid), { status: "active" }, { merge: true }));
  await assertSucceeds(setDoc(doc(adminDb, "users", managerUid), { status: "active" }, { merge: true }));
});

test("unauthenticated requests cannot read or write anything", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "institutions", institutionA)));
  await assertFails(setDoc(doc(db, "institutions", institutionA), { name: "blocked" }, { merge: true }));
  await assertFails(getDoc(doc(db, "users", ownerUid)));
  await assertFails(setDoc(doc(db, "users", ownerUid), { fullName: "blocked" }, { merge: true }));
});

test("cross-institution department and task access is blocked", async () => {
  const db = testEnv.authenticatedContext(employeeUid).firestore();
  await assertFails(getDoc(doc(db, "departments", "department-b")));
  await assertFails(setDoc(doc(db, "departments", "department-b"), { name: "blocked" }, { merge: true }));
  await assertFails(getDoc(doc(db, "tasks", "task-b")));
  await assertFails(setDoc(doc(db, "tasks", "task-b"), { title: "blocked" }, { merge: true }));
});

test("Employee cannot create a department", async () => {
  const db = testEnv.authenticatedContext(employeeUid).firestore();
  await assertFails(setDoc(doc(db, "departments", "employee-department"), departmentData("employee-department", institutionA)));
});

test("Owner and Admin can create a department", async () => {
  const ownerDb = testEnv.authenticatedContext(ownerUid).firestore();
  const adminDb = testEnv.authenticatedContext(adminUid).firestore();
  await assertSucceeds(setDoc(doc(ownerDb, "departments", "owner-department"), departmentData("owner-department", institutionA)));
  await assertSucceeds(setDoc(doc(adminDb, "departments", "admin-department"), departmentData("admin-department", institutionA)));
});

test("Manager can update their own department but not another department", async () => {
  const db = testEnv.authenticatedContext(managerUid).firestore();
  await assertSucceeds(setDoc(doc(db, "departments", "department-a"), { description: "Updated by manager" }, { merge: true }));
  await assertFails(setDoc(doc(db, "departments", "department-c"), { description: "Blocked" }, { merge: true }));
});

test("Employee can update only the status of their assigned task", async () => {
  const db = testEnv.authenticatedContext(employeeUid).firestore();
  await assertSucceeds(setDoc(doc(db, "tasks", "task-a"), { status: "review" }, { merge: true }));
  await assertFails(setDoc(doc(db, "tasks", "task-a"), { assignedTo: managerUid }, { merge: true }));
  await assertFails(setDoc(doc(db, "tasks", "task-a"), { priority: "high" }, { merge: true }));
});

test("Manager can create tasks only within their own department", async () => {
  const db = testEnv.authenticatedContext(managerUid).firestore();
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
  const db = testEnv.authenticatedContext(employeeUid).firestore();
  await assertFails(getDoc(doc(db, "plannerEvents", "event-b")));
  await assertFails(setDoc(doc(db, "plannerEvents", "event-b"), { title: "blocked" }, { merge: true }));
});

test("Employee cannot create a planner event", async () => {
  const db = testEnv.authenticatedContext(employeeUid).firestore();
  await assertFails(setDoc(doc(db, "plannerEvents", "employee-event"), plannerEventData("employee-event", institutionA, null, employeeUid)));
});

test("Owner and Admin can create institution-wide planner events", async () => {
  const ownerDb = testEnv.authenticatedContext(ownerUid).firestore();
  const adminDb = testEnv.authenticatedContext(adminUid).firestore();
  await assertSucceeds(setDoc(doc(ownerDb, "plannerEvents", "owner-event"), plannerEventData("owner-event", institutionA, null, ownerUid)));
  await assertSucceeds(setDoc(doc(adminDb, "plannerEvents", "admin-event"), plannerEventData("admin-event", institutionA, null, adminUid)));
});

test("Manager can create only in their own planner department", async () => {
  const db = testEnv.authenticatedContext(managerUid).firestore();
  await assertSucceeds(setDoc(doc(db, "plannerEvents", "manager-event"), plannerEventData("manager-event", institutionA, "department-a", managerUid)));
  await assertFails(setDoc(doc(db, "plannerEvents", "manager-outside-event"), plannerEventData("manager-outside-event", institutionA, "department-c", managerUid)));
});

test("Employee planner reads are limited to attendees and institution-wide events", async () => {
  const db = testEnv.authenticatedContext(employeeUid).firestore();
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
  const adminDb = testEnv.authenticatedContext(adminUid).firestore();
  const ownerDb = testEnv.authenticatedContext(ownerUid).firestore();
  const employeeDb = testEnv.authenticatedContext(employeeUid).firestore();
  await assertSucceeds(setDoc(doc(adminDb, "conversations", "conversation-a"), conversationData("conversation-a", institutionA, [ownerUid, adminUid], adminUid)));
  await assertSucceeds(getDoc(doc(adminDb, "conversations", "conversation-a")));
  await assertSucceeds(setDoc(doc(ownerDb, "conversations", "institution-wide"), conversationData("institution-wide", institutionA, [], ownerUid, "institution_wide")));
  await assertSucceeds(getDoc(doc(employeeDb, "conversations", "institution-wide")));
  await assertFails(setDoc(doc(employeeDb, "conversations", "institution-wide", "messages", "employee-message"), messageData("employee-message", "institution-wide", institutionA, employeeUid)));
});

test("conversation participants cannot cross institution boundaries", async () => {
  const db = testEnv.authenticatedContext(employeeUid).firestore();
  await assertFails(getDoc(doc(db, "conversations", "conversation-a")));
});

test("non-participants cannot read a direct conversation", async () => {
  const db = testEnv.authenticatedContext(managerUid).firestore();
  await assertFails(getDoc(doc(db, "conversations", "conversation-a")));
});

test("a signed-in user can create a conversation including themselves", async () => {
  const db = testEnv.authenticatedContext(employeeUid).firestore();
  await assertSucceeds(setDoc(doc(db, "conversations", "conversation-employee"), conversationData("conversation-employee", institutionA, [employeeUid, managerUid], employeeUid)));
});

test("users cannot create a conversation in another institution", async () => {
  const db = testEnv.authenticatedContext(employeeUid).firestore();
  await assertFails(setDoc(doc(db, "conversations", "conversation-cross"), conversationData("conversation-cross", institutionB, [employeeUid, otherUid], employeeUid)));
});

test("conversation participants can send messages as themselves", async () => {
  const db = testEnv.authenticatedContext(adminUid).firestore();
  await assertSucceeds(setDoc(doc(db, "conversations", "conversation-a", "messages", "message-a"), messageData("message-a", "conversation-a", institutionA, adminUid)));
  await assertFails(setDoc(doc(db, "conversations", "conversation-a", "messages", "message-forged"), messageData("message-forged", "conversation-a", institutionA, ownerUid)));
});

test("department conversations are limited to the matching department", async () => {
  const managerDb = testEnv.authenticatedContext(managerUid).firestore();
  const employeeDb = testEnv.authenticatedContext(employeeUid).firestore();
  const otherDb = testEnv.authenticatedContext(otherUid).firestore();
  await assertSucceeds(setDoc(doc(managerDb, "conversations", "department-conversation"), conversationData("department-conversation", institutionA, [managerUid], managerUid, "department", "department-a")));
  await assertSucceeds(getDoc(doc(employeeDb, "conversations", "department-conversation")));
  await assertFails(getDoc(doc(otherDb, "conversations", "department-conversation")));
  await assertFails(setDoc(doc(employeeDb, "conversations", "department-conversation", "messages", "employee-message"), messageData("employee-message", "department-conversation", institutionA, employeeUid)));
});
