import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHealthcareDashboardMetrics, calculateHealthcareReadiness, canAccessHealthcareRecord, generateHealthcarePatientNumber, getHealthcareScope } from "../lib/healthcare";

describe("healthcare vertical foundation", () => {
  it("keeps scopes deterministic and role-limited", () => {
    assert.deepEqual(getHealthcareScope("Clinician"), { role: "Clinician", recordKinds: ["patient", "encounter", "service", "clinical", "document"], scope: "assigned" });
    assert.equal(getHealthcareScope("Employee").scope, "none");
  });

  it("requires module, sensitivity, and assignment checks", () => {
    const input = { role: "Clinician", recordKind: "clinical" as const, moduleEnabled: true, sensitivity: "sensitive" as const, patientId: "p1", assignedPatientIds: ["p2"] };
    assert.equal(canAccessHealthcareRecord(input).allowed, false);
    assert.equal(canAccessHealthcareRecord({ ...input, hasSensitivePermission: true, assignedPatientIds: ["p1"] }).allowed, true);
  });

  it("reports setup without fabricating readiness", () => {
    const result = calculateHealthcareReadiness({ institutionConfigured: true, profileConfigured: false, patientIdentityConfigured: false, encountersConfigured: false, servicesConfigured: false, clinicalAccessConfigured: false, billingIntegrationConfigured: false, documentsConfigured: false });
    assert.equal(result.ready, false);
    assert.equal(result.completed, 1);
  });

  it("generates institution-scoped patient numbers and dashboard metrics", () => {
    const patientNumber = generateHealthcarePatientNumber("Acme Hospital", 12);
    assert.match(patientNumber, /^PT-[A-Z0-9]+-\d{6}$/);

    const metrics = buildHealthcareDashboardMetrics({
      patients: [{ status: "active" }, { status: "inactive" }],
      encounters: [{ status: "open" }, { status: "closed" }],
      services: [{ active: true }, { active: false }],
      queueEntries: [{ status: "waiting" }, { status: "completed" }],
      billing: [{ status: "paid" }, { status: "pending" }],
      clinicalRecords: [{ sensitivity: "sensitive" }, { sensitivity: "standard" }],
      resources: [{ available: true }, { available: false }],
    });

    assert.equal(metrics.activePatients, 1);
    assert.equal(metrics.openEncounters, 1);
    assert.equal(metrics.waitingQueue, 1);
    assert.equal(metrics.paidBilling, 1);
    assert.equal(metrics.sensitiveClinical, 1);
    assert.equal(metrics.utilization, 50);
  });
});
