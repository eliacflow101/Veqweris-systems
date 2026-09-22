import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateHostelOccupancy, canAccessSchoolArea } from "../lib/school/operations";

describe("school operational scope", () => {
  it("keeps sensitive health access separate from ordinary role access", () => {
    assert.equal(canAccessSchoolArea({ area: "health", role: "Teacher", moduleEnabled: true, sensitivity: "highly_sensitive", hasSensitivePermission: false }).allowed, false);
    assert.equal(canAccessSchoolArea({ area: "health", role: "Admin", moduleEnabled: true, sensitivity: "highly_sensitive", hasSensitivePermission: true }).allowed, true);
  });

  it("limits operational areas by role", () => {
    assert.equal(canAccessSchoolArea({ area: "library", role: "Librarian", moduleEnabled: true, sensitivity: "standard", hasSensitivePermission: false }).allowed, true);
    assert.equal(canAccessSchoolArea({ area: "transport", role: "Librarian", moduleEnabled: true, sensitivity: "standard", hasSensitivePermission: false }).allowed, false);
  });

  it("calculates hostel capacity without inventing availability", () => {
    assert.deepEqual(calculateHostelOccupancy(20, 17), { capacity: 20, occupied: 17, available: 3, full: false });
  });

  it("covers the configured operational school roles without broadening access", () => {
    const roleAreas: Array<[string, string, boolean]> = [
      ["Principal/Admin", "library", true],
      ["Academic Head", "transport", false],
      ["Teacher", "health", false],
      ["Finance Officer", "library", false],
      ["Admissions Officer", "hostel", false],
      ["Librarian", "library", true],
      ["Warden", "hostel", true],
      ["Counselor", "welfare", true],
      ["Student", "library", false],
      ["Guardian", "transport", false],
    ];
    for (const [role, area, expected] of roleAreas) {
      const normalizedRole = role === "Principal/Admin" ? "Admin" : role;
      const result = canAccessSchoolArea({
        area: area as "library" | "transport" | "hostel" | "health" | "welfare" | "safeguarding",
        role: normalizedRole,
        moduleEnabled: true,
        sensitivity: area === "health" ? "highly_sensitive" : "standard",
        hasSensitivePermission: role === "Principal/Admin",
      });
      assert.equal(result.allowed, expected, `${role} access to ${area}`);
    }
  });
});
