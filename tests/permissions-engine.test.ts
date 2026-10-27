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
import { transitionSecurityIncident } from "../lib/security-center/engine";

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
    const admin = defaultMembership({ institutionId: "institution-a", tier: "Admin" });
    const owner = defaultMembership({ institutionId: "institution-a", tier: "Owner" });
    assert.equal(compileEffectivePermissions(employee, []).some((grant) => grant.key === "finance.payment.refund"), false);
    assert.equal(compileEffectivePermissions(manager, []).some((grant) => grant.key === "health.record.read"), false);
    for (const membership of [employee, manager, admin, owner]) {
      assert.equal(compileEffectivePermissions(membership, []).some((grant) => grant.key === "health.record.write"), false);
    }
    for (const membership of [admin, owner]) {
      assert.equal(compileEffectivePermissions(membership, []).some((grant) => grant.key === "security.center.read"), false);
      assert.equal(compileEffectivePermissions(membership, []).some((grant) => grant.key === "security.incident.manage"), false);
      assert.equal(compileEffectivePermissions(membership, []).some((grant) => grant.key === "security.incident.contain"), false);
    }
  });

  it("grants Security Center capabilities only through an explicit institution role", () => {
    const membership = {
      ...defaultMembership({ institutionId: "institution-a", tier: "Admin" }),
      roleIds: ["security-reviewer"],
    };
    const role: CustomRoleAuthorization = {
      roleId: "security-reviewer",
      institutionId: "institution-a",
      tierCeiling: "Admin",
      status: "active",
      version: 1,
      permissions: [
        { key: "security.center.read" },
        { key: "security.incident.manage" },
        { key: "security.incident.contain" },
      ],
    };
    const grants = compileEffectivePermissions(membership, [role]);
    assert.ok(grants.some((grant) => grant.key === "security.center.read"));
    assert.ok(grants.some((grant) => grant.key === "security.incident.manage"));
    assert.ok(grants.some((grant) => grant.key === "security.incident.contain"));
  });

  it("enforces incident lifecycle transitions and reasoned reopening", () => {
    assert.equal(transitionSecurityIncident("draft", "OPEN", "Reviewed evidence."), "OPEN");
    assert.throws(() => transitionSecurityIncident("draft", "CLOSED", "Reviewed evidence."), /Invalid incident transition/);
    assert.throws(() => transitionSecurityIncident("RESOLVED", "TRIAGED", "short"), /requires a reason/);
    assert.equal(transitionSecurityIncident("CLOSED", "TRIAGED", "New evidence reviewed."), "TRIAGED");
  });

  it("compiles health record write only when explicitly granted by a role", () => {
    const membership = {
      ...defaultMembership({ institutionId: "institution-a", tier: "Employee" }),
      roleIds: ["clinical-writer"],
    };
    const role: CustomRoleAuthorization = {
      roleId: "clinical-writer",
      institutionId: "institution-a",
      tierCeiling: "Employee",
      status: "active",
      version: 1,
      permissions: [{
        key: "health.record.write",
        scope: { institutionId: "institution-a" },
      }],
    };
    const grants = compileEffectivePermissions(membership, [role]);
    assert.ok(grants.some((grant) => grant.key === "health.record.write"));
    assert.equal(grants.some((grant) => grant.key === "health.record.read"), false);
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
