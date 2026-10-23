import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, test } from "node:test";
import { FieldValue } from "firebase-admin/firestore";
import { withInstitutionCapacity } from "../lib/platform/capacity";
import { subscriptionPlans } from "../lib/platform/engine";

const projectId = "demo-veqweris-capacity";
const limits = {
  maxUsers: 1,
  maxDepartments: 1,
  maxStorageMb: 1,
  maxMonthlyNotifications: 1,
  maxIntegrationEndpoints: 1,
};

process.env.FIREBASE_PROJECT_ID = projectId;
process.env.FIREBASE_CLIENT_EMAIL = "capacity-tests@demo-veqweris-capacity.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";

let db: import("firebase-admin/firestore").Firestore;

async function createInstitution(institutionId: string, planTier = "basic") {
  await db.collection("institutions").doc(institutionId).set({
    institutionId, name: institutionId, status: "active", planTier, relationship: "Customer",
  });
}

before(async () => {
  const admin = await import("../lib/firebase/admin");
  assert.ok(admin.adminDb, "Firestore Admin emulator configuration is required.");
  db = admin.adminDb;
  const basic = subscriptionPlans.find((plan) => plan.planId === "basic");
  assert.ok(basic);
  await db.collection("platformPlanCatalog").doc("basic").set({ ...basic, limits });
});

after(async () => {
  const { getApps, deleteApp } = await import("firebase-admin/app");
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

test("concurrent user, department, notification, and integration writes cannot exceed limits", async () => {
  const cases = [
    { id: "capacity-users", limit: "maxUsers" as const, collection: "users" },
    { id: "capacity-departments", limit: "maxDepartments" as const, collection: "departments" },
    { id: "capacity-notifications", limit: "maxMonthlyNotifications" as const, collection: "notifications" },
    { id: "capacity-integrations", limit: "maxIntegrationEndpoints" as const, collection: "integrations" },
  ];

  for (const item of cases) {
    await createInstitution(item.id);
    const writes = [0, 1].map(() => {
      const ref = db.collection(item.collection).doc();
      return withInstitutionCapacity({
        db,
        institutionId: item.id,
        limit: item.limit,
        amount: 1,
        write: (transaction) => transaction.create(ref, {
          institutionId: item.id,
          createdAt: FieldValue.serverTimestamp(),
        }),
      });
    });
    const results = await Promise.allSettled(writes);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, item.limit);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1, item.limit);
    const count = await db.collection(item.collection).where("institutionId", "==", item.id).count().get();
    assert.equal(count.data().count, 1, item.limit);
  }
});

test("existing resources at or above capacity are not grandfathered into new writes", async () => {
  await createInstitution("capacity-existing-user");
  await db.collection("users").doc("existing-capacity-user").set({ institutionId: "capacity-existing-user" });
  await assert.rejects(withInstitutionCapacity({
    db,
    institutionId: "capacity-existing-user",
    limit: "maxUsers",
    amount: 1,
    write: (transaction) => transaction.create(db.collection("users").doc("new-capacity-user"), {
      institutionId: "capacity-existing-user",
    }),
  }), /PLAN_LIMIT_EXCEEDED/);

  await createInstitution("capacity-over-limit");
  await db.collection("users").doc("over-limit-user-a").set({ institutionId: "capacity-over-limit" });
  await db.collection("users").doc("over-limit-user-b").set({ institutionId: "capacity-over-limit" });
  await assert.rejects(withInstitutionCapacity({
    db,
    institutionId: "capacity-over-limit",
    limit: "maxUsers",
    amount: 1,
    write: (transaction) => transaction.create(db.collection("users").doc("new-over-limit-user"), {
      institutionId: "capacity-over-limit",
    }),
  }), /PLAN_LIMIT_EXCEEDED/);
});

test("storage capacity uses actual byte totals and allows writes up to the configured boundary", async () => {
  await createInstitution("capacity-storage");
  const storageDoc = db.collection("documents").doc("capacity-storage-at-limit");
  await withInstitutionCapacity({
    db,
    institutionId: "capacity-storage",
    limit: "maxStorageMb",
    amount: 1024 * 1024,
    write: (transaction) => transaction.create(storageDoc, {
      institutionId: "capacity-storage",
      size: 1024 * 1024,
    }),
  });
  await assert.rejects(withInstitutionCapacity({
    db,
    institutionId: "capacity-storage",
    limit: "maxStorageMb",
    amount: 1,
    write: (transaction) => transaction.create(db.collection("documents").doc("capacity-storage-over"), {
      institutionId: "capacity-storage",
      size: 1,
    }),
  }), /PLAN_LIMIT_EXCEEDED/);
});

test("failed persistence does not consume capacity and Internal keeps its unlimited policy", async () => {
  await createInstitution("capacity-write-failure");
  await assert.rejects(withInstitutionCapacity({
    db,
    institutionId: "capacity-write-failure",
    limit: "maxDepartments",
    amount: 1,
    write: () => { throw new Error("simulated write failure"); },
  }), /simulated write failure/);
  await withInstitutionCapacity({
    db,
    institutionId: "capacity-write-failure",
    limit: "maxDepartments",
    amount: 1,
    write: (transaction) => transaction.create(db.collection("departments").doc("capacity-after-failure"), {
      institutionId: "capacity-write-failure",
    }),
  });

  await createInstitution("capacity-internal", "internal");
  await withInstitutionCapacity({
    db,
    institutionId: "capacity-internal",
    limit: "maxUsers",
    amount: 100,
    write: (transaction) => transaction.create(db.collection("users").doc("capacity-internal-users"), {
      institutionId: "capacity-internal",
    }),
  });
});

test("capacity is recalculated safely on upgrade and downgrade and Partner limits stay finite", async () => {
  await createInstitution("capacity-plan-change");
  await db.collection("users").doc("capacity-plan-change-existing").set({
    institutionId: "capacity-plan-change",
  });
  const createUser = (id: string) => withInstitutionCapacity({
    db,
    institutionId: "capacity-plan-change",
    limit: "maxUsers",
    amount: 1,
    write: (transaction) => transaction.create(db.collection("users").doc(id), {
      institutionId: "capacity-plan-change",
    }),
  });
  await assert.rejects(createUser("capacity-plan-change-blocked"), /PLAN_LIMIT_EXCEEDED/);
  await db.collection("institutions").doc("capacity-plan-change").update({ planTier: "enterprise" });
  await createUser("capacity-plan-change-upgraded");
  await db.collection("institutions").doc("capacity-plan-change").update({ planTier: "basic" });
  await assert.rejects(createUser("capacity-plan-change-downgraded"), /PLAN_LIMIT_EXCEEDED/);

  const partner = subscriptionPlans.find((plan) => plan.planId === "partner");
  assert.ok(partner);
  await db.collection("platformPlanCatalog").doc("partner").set(partner);
  await createInstitution("capacity-partner", "partner");
  const users = Array.from({ length: 250 }, (_, index) => db.collection("users").doc(`capacity-partner-user-${index}`));
  await withInstitutionCapacity({
    db,
    institutionId: "capacity-partner",
    limit: "maxUsers",
    amount: users.length,
    write: (transaction) => users.forEach((ref) => transaction.create(ref, {
      institutionId: "capacity-partner",
    })),
  });
  await assert.rejects(withInstitutionCapacity({
    db,
    institutionId: "capacity-partner",
    limit: "maxUsers",
    amount: 1,
    write: (transaction) => transaction.create(db.collection("users").doc("capacity-partner-over"), {
      institutionId: "capacity-partner",
    }),
  }), /PLAN_LIMIT_EXCEEDED/);
});
