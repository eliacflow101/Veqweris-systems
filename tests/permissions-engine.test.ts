import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canGrantPermission,
  compileEffectivePermissions,
  defaultMembership,
  isStepUpAuthenticationRecent,
  permissionScopeAllows,
  type CustomRoleAuthorization,
} from "../lib/permissions/engine";

describe("permission resolution", () => {
  it("denies unregistered permissions, inactive membership, and expired access", () => {
    const membership = defaultMembership({ institutionId: "institution-a", tier: "Employee" });
    assert.deepEqual(compileEffectivePermissions(membership, []).some((grant) => grant.key === "unknown.read"), false);
    assert.equal(permissionScopeAllows({ key: "unknown.read" }, membership, {}, "user-a"), false);
    assert.deepEqual(compileEffectivePermissions({ ...membership, status: "inactive" }, []), []);
    assert.deepEqual(compileEffectivePermissions({ ...membership, validTo: 100 }, [], 100), []);
    assert.deepEqual(compileEffectivePermissions({ ...membership, validFrom: 101 }, [], 100), []);
  });

  it("applies tier floors and does not grant restricted health access by default", () => {
    const employee = defaultMembership({ institutionId: "institution-a", tier: "Employee" });
    const manager = defaultMembership({ institutionId: "institution-a", tier: "Manager" });
    assert.equal(compileEffectivePermissions(employee, []).some((grant) => grant.key === "finance.payment.refund"), false);
    assert.equal(compileEffectivePermissions(manager, []).some((grant) => grant.key === "health.record.read"), false);
  });

  it("intersects custom role scope with membership scope", () => {
    const membership = {
      ...defaultMembership({ institutionId: "institution-a", tier: "Manager" }),
      roleIds: ["role-scoped"],
      departmentIds: ["department-a", "department-b"],
    };
    const role: CustomRoleAuthorization = {
      roleId: "role-scoped",
      institutionId: "institution-a",
      tierCeiling: "Manager",
      status: "active",
      version: 1,
      permissions: [{
        key: "tasks.manage",
        scope: { departmentIds: ["department-a"], sensitivityCeiling: "INTERNAL" },
      }],
    };
    const grant = compileEffectivePermissions(membership, [role]).find((item) => item.key === "tasks.manage");
    assert.ok(grant);
    assert.equal(permissionScopeAllows(grant, membership, {
      institutionId: "institution-a",
      departmentIds: ["department-a"],
      sensitivityCeiling: "INTERNAL",
    }, "manager-a"), true);
    assert.equal(permissionScopeAllows(grant, membership, {
      institutionId: "institution-a",
      departmentIds: ["department-b"],
      sensitivityCeiling: "INTERNAL",
    }, "manager-a"), false);
    assert.equal(permissionScopeAllows(grant, membership, {
      institutionId: "institution-b",
      departmentIds: ["department-a"],
      sensitivityCeiling: "INTERNAL",
    }, "manager-a"), false);
  });

  it("bounds manager grants to membership departments even without custom roles", () => {
    const membership = {
      ...defaultMembership({ institutionId: "institution-a", tier: "Manager" }),
      departmentIds: ["department-a"],
    };
    const grant = compileEffectivePermissions(membership, []).find((item) => item.key === "tasks.manage");
    assert.ok(grant);
    assert.equal(permissionScopeAllows(grant, membership, { departmentIds: ["department-a"] }, "manager-a"), true);
    assert.equal(permissionScopeAllows(grant, membership, { departmentIds: ["department-b"] }, "manager-a"), false);
  });

  it("prevents granting permissions outside the actor's held authority", () => {
    const employee = defaultMembership({ institutionId: "institution-a", tier: "Employee" });
    const grants = compileEffectivePermissions(employee, []);
    assert.equal(canGrantPermission("Employee", grants, { key: "employees.access.manage" }), false);
    assert.equal(canGrantPermission("Employee", grants, { key: "tasks.read" }), true);
    assert.equal(canGrantPermission("Owner", [], { key: "finance.payment.refund" }), true);
    assert.equal(canGrantPermission("Owner", [], { key: "unknown.read" }), false);
  });

  it("requires a fresh authentication timestamp for dangerous permissions", () => {
    assert.equal(isStepUpAuthenticationRecent(995, 1_000), true);
    assert.equal(isStepUpAuthenticationRecent(699, 1_000), false);
    assert.equal(isStepUpAuthenticationRecent(1_001, 1_000), false);
    assert.equal(isStepUpAuthenticationRecent(undefined, 1_000), false);
  });
});
