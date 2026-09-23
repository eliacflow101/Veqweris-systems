import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { deleteObject, getMetadata, ref, uploadBytes } from "firebase/storage";

const projectId = "demo-veqweris";
const institutionA = "institution-a";
const institutionB = "institution-b";
const ownerUid = "owner-a";
const adminUid = "admin-a";
const employeeUid = "employee-a";
const inactiveUid = "inactive-a";
const otherUid = "employee-b";

let testEnv: RulesTestEnvironment;

function userData(uid: string, role: "Owner" | "Admin" | "Employee", institutionId: string, status = "active") {
  return {
    uid,
    institutionId,
    fullName: uid,
    email: `${uid}@example.com`,
    role,
    status,
  };
}

async function seedUsers() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users", ownerUid), userData(ownerUid, "Owner", institutionA)),
      setDoc(doc(db, "users", adminUid), userData(adminUid, "Admin", institutionA)),
      setDoc(doc(db, "users", employeeUid), userData(employeeUid, "Employee", institutionA)),
      setDoc(doc(db, "users", inactiveUid), userData(inactiveUid, "Employee", institutionA, "inactive")),
      setDoc(doc(db, "users", otherUid), userData(otherUid, "Employee", institutionB)),
    ]);
  });
}

function storageFor(uid?: string) {
  return (uid ? testEnv.authenticatedContext(uid) : testEnv.unauthenticatedContext()).storage();
}

function file(storage: ReturnType<typeof storageFor>, path: string) {
  return ref(storage, path);
}

async function upload(uid: string | undefined, path: string, bytes: Uint8Array, contentType?: string) {
  const metadata = { contentType: contentType ?? "text/csv" };
  return uploadBytes(file(storageFor(uid), path), bytes, metadata);
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
    storage: {
      host: "127.0.0.1",
      port: 9199,
      rules: readFileSync(resolve(process.cwd(), "storage.rules"), "utf8"),
    },
  });
  await seedUsers();
});

beforeEach(async () => {
  await testEnv.clearStorage();
});

after(async () => {
  await testEnv.cleanup();
});

test("rejects unauthenticated storage reads and writes", async () => {
  await assertFails(upload(undefined, `quarantine/${institutionA}/unauthenticated.csv`, new Uint8Array([1]), "text/csv"));
  await assertFails(getMetadata(file(storageFor(), `quarantine/${institutionA}/missing.csv`)));
});

test("enforces tenant isolation for reads, writes, and deletes", async () => {
  await assertSucceeds(upload(otherUid, `quarantine/${institutionB}/other.csv`, new Uint8Array([1]), "text/csv"));
  await assertFails(getMetadata(file(storageFor(employeeUid), `quarantine/${institutionB}/other.csv`)));
  await assertFails(upload(employeeUid, `documents/${institutionB}/other.pdf`, new Uint8Array([1]), "application/pdf"));
  await assertFails(deleteObject(file(storageFor(ownerUid), `quarantine/${institutionB}/other.csv`)));
});

test("allows authorized operations in the user's institution", async () => {
  await assertSucceeds(upload(employeeUid, `quarantine/${institutionA}/employee.csv`, new Uint8Array([1]), "text/csv"));
  await assertSucceeds(getMetadata(file(storageFor(employeeUid), `quarantine/${institutionA}/employee.csv`)));
  await assertSucceeds(upload(ownerUid, `documents/${institutionA}/approved.pdf`, new Uint8Array([1]), "application/pdf"));
  await assertSucceeds(upload(adminUid, `documents/${institutionA}/admin.pdf`, new Uint8Array([1]), "application/pdf"));
});

test("restricts quarantine writes and document writes by account status and role", async () => {
  await assertFails(upload(inactiveUid, `quarantine/${institutionA}/inactive.csv`, new Uint8Array([1]), "text/csv"));
  await assertFails(upload(employeeUid, `documents/${institutionA}/employee.pdf`, new Uint8Array([1]), "application/pdf"));
});

test("enforces quarantine content type and size limits", async () => {
  await assertSucceeds(upload(employeeUid, `quarantine/${institutionA}/valid.csv`, new Uint8Array([1]), "text/csv"));
  await assertFails(upload(employeeUid, `quarantine/${institutionA}/invalid.txt`, new Uint8Array([1]), "text/plain"));
  await assertFails(upload(employeeUid, `quarantine/${institutionA}/empty.csv`, new Uint8Array(), "text/csv"));
  await assertFails(
    upload(
      employeeUid,
      `quarantine/${institutionA}/too-large.csv`,
      new Uint8Array(25 * 1024 * 1024 + 1),
      "text/csv",
    ),
  );
});

test("allows only owners and admins to delete files in their institution", async () => {
  await assertSucceeds(upload(employeeUid, `quarantine/${institutionA}/owned.csv`, new Uint8Array([1]), "text/csv"));
  await assertFails(deleteObject(file(storageFor(employeeUid), `quarantine/${institutionA}/owned.csv`)));
  await assertSucceeds(deleteObject(file(storageFor(ownerUid), `quarantine/${institutionA}/owned.csv`)));

  await assertSucceeds(upload(ownerUid, `documents/${institutionA}/admin-delete.pdf`, new Uint8Array([1]), "application/pdf"));
  await assertSucceeds(deleteObject(file(storageFor(adminUid), `documents/${institutionA}/admin-delete.pdf`)));
});
