import assert from "node:assert/strict";
import { buildSetupRequirements, calculateSetupProgress, defaultSetupConfig, evaluateSetupRequirements, recommendDepartments, transitionSetupRequirement } from "../lib/setup";

for (const module of ["generic", "school", "hospital", "hotel"] as const) {
  const config = defaultSetupConfig("institution-1", module);
  const requirements = buildSetupRequirements("institution-1", config);
  assert.ok(requirements.length >= 6);
  if (module !== "generic") assert.ok(requirements.some((item) => item.module === module));
  assert.equal(calculateSetupProgress(requirements).percent, 0);
  assert.ok(recommendDepartments(module).length > 0);
}

const generic = buildSetupRequirements("institution-1", defaultSetupConfig("institution-1"))[0];
assert.throws(() => transitionSetupRequirement(generic, "Completed", "owner-1"));
const verified = evaluateSetupRequirements([generic], defaultSetupConfig("institution-1"), {
  institutionExists: true,
  institutionProfileComplete: true,
  activeUsers: [{ role: "Owner", status: "active" }],
  departmentCount: 1,
  collections: {},
});
assert.equal(verified[0].state, "Completed");
assert.equal(calculateSetupProgress(verified).readiness, "Ready");
const unmet = evaluateSetupRequirements([generic], defaultSetupConfig("institution-1"), {
  institutionExists: true,
  institutionProfileComplete: false,
  activeUsers: [],
  departmentCount: 0,
  collections: {},
});
assert.notEqual(unmet[0].state, "Completed");
console.log("setup-engine tests passed");
