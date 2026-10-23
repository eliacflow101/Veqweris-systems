import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { getMetadata, ref, uploadBytes } from "firebase/storage";

const projectId = "demo-veqweris";
const institutionA = "institution-a";
const institutionB = "institution-b";
const ownerUid = "owner-a";
const employeeUid = "employee-a";

let testEnv: RulesTestEnvironment;

async function seedUsers() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "institutions", institutionA), { institutionId: institutionA, status: "active", planTier: "enterprise" }),
      setDoc(doc(db, "institutions", institutionB), { institutionId: institutionB, status: "active", planTier: "enterprise" }),
      setDoc(doc(db, "users", ownerUid), {
        uid: ownerUid, institutionId: institutionA, role: "Owner", status: "active",
      }),
      setDoc(doc(db, "users", employeeUid), {
        uid: employeeUid, institutionId: institutionA, role: "Employee", status: "active",
      }),
    ]);
  });
}

function storageFor(uid?: string) {
  return (uid ? testEnv.authenticatedContext(uid) : testEnv.unauthenticatedContext()).storage();
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

after(async () => {
  await testEnv.cleanup();
});

test("tenant storage is server-mediated so capacity and lifecycle checks cannot be bypassed", async () => {
  for (const uid of [ownerUid, employeeUid, "employee-b"]) {
    await assertFails(uploadBytes(ref(storageFor(uid), `documents/${institutionA}/${uid}.pdf`), new Uint8Array([1]), {
      contentType: "application/pdf",
    }));
    await assertFails(getMetadata(ref(storageFor(uid), `documents/${institutionA}/missing.pdf`)));
    await assertFails(uploadBytes(ref(storageFor(uid), `quarantine/${institutionA}/${uid}.csv`), new Uint8Array([1]), {
      contentType: "text/csv",
    }));
  }
});

test("tenant storage cannot be accessed anonymously or across institutions", async () => {
  await assertFails(uploadBytes(ref(storageFor(), `documents/${institutionA}/anonymous.pdf`), new Uint8Array([1])));
  await assertFails(uploadBytes(ref(storageFor(employeeUid), `documents/${institutionB}/cross-tenant.pdf`), new Uint8Array([1])));
  await assertFails(getMetadata(ref(storageFor(employeeUid), `quarantine/${institutionB}/missing.csv`)));
});
