import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assessDuplicateState,
  createOperationalAccessProfile,
  createPeopleDirectoryEntry,
  generateInstitutionBoundEmployeeId,
  validateBulkImportRow,
  validateTerminalAccess,
} from "../lib/people-engine";

describe("people management and scoped operational access", () => {
  it("generates institution-scoped employee IDs without exposing global identity sequences", () => {
    const idA = generateInstitutionBoundEmployeeId("institution-a", "Alex Morgan", ["INSTITUTION-A-ALEX-0001"]);
    const idB = generateInstitutionBoundEmployeeId("institution-b", "Rae Smith", []);

    assert.match(idA, /^INSTITUTION-A-/);
    assert.ok(idA.includes("ALEX"));
    assert.ok(idB.includes("INSTITUTION-B"));
    assert.doesNotMatch(idA, /00000001/);
  });

  it("flags duplicate and review states without auto-merging by name alone", () => {
    const existing = [{
      rowId: "existing-1",
      institutionEmployeeId: "INST-A-ALM-0001",
      fullName: "Alex Morgan",
      officialEmail: "alex@example.com",
      phone: "+1 555 100 2000",
      department: "Operations",
      role: "Manager",
    }];

    const duplicate = assessDuplicateState({
      institutionEmployeeId: "",
      fullName: "Alex Morgan",
      officialEmail: "alex@example.com",
      phone: "+1 555 100 2000",
      department: "Operations",
      role: "Manager",
    }, existing);

    const review = assessDuplicateState({
      institutionEmployeeId: "",
      fullName: "Alex Morgan",
      officialEmail: "",
      phone: "",
      department: "Operations",
      role: "Manager",
    }, existing);

    assert.equal(duplicate, "Existing Match");
    assert.equal(review, "Needs Review");
  });

  it("rejects malicious import rows and blocks unsafe bulk creation", () => {
    const existing: any[] = [];
    const result = validateBulkImportRow({
      rowId: "bad-row",
      fullName: "<script>alert(1)</script>",
      officialEmail: "malicious@example.com",
      department: "IT",
      role: "Operator",
    }, existing);

    assert.equal(result.allowed, false);
    assert.ok(result.issues.some((issue) => issue.includes("Malicious")));
  });

  it("binds terminal access to page, department, module and revocation policy", () => {
    const terminal = createOperationalAccessProfile({
      terminalId: "terminal-kitchen-a",
      institutionId: "institution-a",
      label: "Kitchen Terminal",
      scope: "Kitchen Terminal",
      allowedPages: ["/tasks", "/inventory"],
      allowedActions: ["view", "consume"],
      departmentScope: ["department-kitchen"],
      moduleScope: ["inventory", "tasks"],
      sessionMinutes: 60,
      autoLockSeconds: 300,
      requiresReauthForSensitiveActions: true,
    });

    const allowed = validateTerminalAccess(terminal, "/inventory", "consume", "department-kitchen", "inventory");
    const blocked = validateTerminalAccess(terminal, "/employees", "view", "department-kitchen", "employees");
    const revoked = { ...terminal, status: "revoked" as const };
    const revokedResult = validateTerminalAccess(revoked, "/inventory", "consume", "department-kitchen", "inventory");

    assert.equal(allowed.allowed, true);
    assert.equal(blocked.allowed, false);
    assert.equal(revokedResult.allowed, false);
  });

  it("creates a people directory entry from the institution-bound identity model", () => {
    const person = createPeopleDirectoryEntry({
      institutionId: "institution-a",
      fullName: "Sam Patel",
      email: "sam@example.com",
      departmentId: "department-ops",
      role: "Service Worker",
      position: "Support Operator",
      employmentType: "part_time",
    });

    assert.match(person.institutionEmployeeId, /^INSTITUTION-A-/);
    assert.equal(person.role, "Service Worker");
    assert.equal(person.status, "active");
  });
});
