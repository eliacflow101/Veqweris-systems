import assert from "node:assert/strict";
import { test } from "node:test";
import { canReadDocument } from "../lib/documents/access";
import { compileEffectivePermissions, defaultMembership, type MembershipAuthorization } from "../lib/permissions/engine";
import type { PermissionContext } from "../lib/permissions/server";

function context(
  membership: MembershipAuthorization,
  scope?: { departmentIds?: string[]; locationIds?: string[]; ownRecordsOnly?: boolean },
): Pick<PermissionContext, "uid" | "institutionId" | "tier" | "grants" | "membership"> {
  const assignedMembership = { ...membership, roleIds: ["document-reader"] };
  const grants = compileEffectivePermissions(assignedMembership, [{
    roleId: "document-reader",
    institutionId: assignedMembership.institutionId,
    tierCeiling: assignedMembership.tier,
    status: "active",
    version: 1,
    permissions: [{ key: "documents.read", scope }],
  }]);
  return {
    uid: "reader",
    institutionId: assignedMembership.institutionId,
    tier: assignedMembership.tier,
    grants,
    membership: assignedMembership,
  };
}

test("document reads require tenant and resource scope authorization", () => {
  const membership = {
    ...defaultMembership({ institutionId: "institution-a", tier: "Employee", departmentId: "department-a" }),
    departmentIds: ["department-a"],
  };
  const authorization = context(membership);

  assert.equal(canReadDocument({
    institutionId: "institution-a",
    uploadedBy: "reader",
    departmentId: "department-a",
  }, authorization), true);
  assert.equal(canReadDocument({
    institutionId: "institution-b",
    uploadedBy: "reader",
    departmentId: "department-a",
  }, authorization), false);
  assert.equal(canReadDocument({
    institutionId: "institution-a",
    uploadedBy: "another-user",
    departmentId: "department-b",
  }, authorization), false);

  const manager = context({
    ...membership,
    tier: "Manager",
    departmentIds: ["department-a"],
  });
  assert.equal(canReadDocument({
    institutionId: "institution-a",
    uploadedBy: "another-user",
    departmentId: "department-a",
  }, manager), true);
});

test("explicit role dimensions and own-record restrictions fail closed", () => {
  const membership = defaultMembership({ institutionId: "institution-a", tier: "Owner" });
  const scoped = context(membership, { departmentIds: ["department-a"], ownRecordsOnly: true });

  assert.equal(canReadDocument({
    institutionId: "institution-a",
    uploadedBy: "reader",
    departmentId: "department-a",
  }, scoped), true);
  assert.equal(canReadDocument({
    institutionId: "institution-a",
    uploadedBy: "another-user",
    departmentId: "department-a",
  }, scoped), false);
  assert.equal(canReadDocument({
    institutionId: "institution-a",
    uploadedBy: "reader",
    departmentId: "department-b",
  }, scoped), false);
  assert.equal(canReadDocument({
    institutionId: "institution-a",
    uploadedBy: "reader",
  }, scoped), false);
});
