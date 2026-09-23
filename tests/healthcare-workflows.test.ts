import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canAccessHealthcareRecord, canReleaseLaboratoryResult, canTransitionLaboratoryRequest } from "../lib/healthcare";

describe("healthcare laboratory and pharmacy boundaries", () => {
  it("requires the deterministic laboratory lifecycle", () => {
    assert.equal(canTransitionLaboratoryRequest("requested", "authorized"), true);
    assert.equal(canTransitionLaboratoryRequest("requested", "released"), false);
    assert.equal(canTransitionLaboratoryRequest("verified", "released"), true);
  });

  it("does not release unverified laboratory results", () => {
    assert.equal(canReleaseLaboratoryResult({ status: "entered", verifiedBy: null }), false);
    assert.equal(canReleaseLaboratoryResult({ status: "verified", verifiedBy: "clinician-1" }), true);
  });

  it("keeps pharmacy and clinical access sensitive", () => {
    assert.equal(canAccessHealthcareRecord({
      role: "Pharmacist",
      recordKind: "clinical",
      moduleEnabled: true,
      sensitivity: "sensitive",
      hasSensitivePermission: true,
    }).allowed, false);
    assert.equal(canAccessHealthcareRecord({
      role: "Clinician",
      recordKind: "clinical",
      moduleEnabled: true,
      sensitivity: "sensitive",
      hasSensitivePermission: true,
      patientId: "patient-1",
      assignedPatientIds: ["patient-1"],
    }).allowed, true);
  });
});
