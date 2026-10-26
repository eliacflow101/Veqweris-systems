import assert from "node:assert/strict";
import {
  buildProvisioningRequestHash,
  computeInstitutionId,
  createInitialInstitutionRecord,
  createProvisioningRun,
  validateProvisioningRequest,
} from "@/lib/provisioning/engine";

const request = {
  institutionName: "Veqweris Labs",
  country: "United States",
  fullName: "Alicia Green",
  email: "alicia@example.com",
  institutionType: "general-business",
  idempotencyKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

const parsed = validateProvisioningRequest(request);
assert.equal(parsed.institutionType, "general-business");
assert.equal(parsed.country, "United States");
assert.equal(parsed.email, "alicia@example.com");
assert.throws(() => validateProvisioningRequest({ ...request, institutionName: "" }), /Institution name/);

const hashA = buildProvisioningRequestHash("user-1", parsed);
const hashB = buildProvisioningRequestHash("user-1", { ...parsed, idempotencyKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
assert.notEqual(hashA, hashB);
assert.ok(computeInstitutionId("user-1", parsed).startsWith("inst_"));

const institution = createInitialInstitutionRecord({
  institutionId: "inst_test_123",
  createdBy: "user-1",
  institutionName: "Veqweris Labs",
  country: "United States",
  institutionType: "general-business",
  now: "2025-01-01T00:00:00.000Z",
});
assert.equal(institution.status, "active");
assert.equal(institution.configPackId, "general");
assert.equal(institution.subscription.planId, "basic");

const run = createProvisioningRun({
  uid: "user-1",
  institutionId: "inst_test_123",
  institutionName: "Veqweris Labs",
  country: "United States",
  email: "alicia@example.com",
  institutionType: "general-business",
  idempotencyKey: request.idempotencyKey,
  now: "2025-01-01T00:00:00.000Z",
});
assert.equal(run.steps[0].status, "completed");
assert.equal(run.status, "pending");

console.log("provisioning-engine tests passed");
