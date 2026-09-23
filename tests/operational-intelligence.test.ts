import assert from "node:assert/strict";
import { buildOperationalCues, calculateOperationalLoad, createOperationalEvent, createServiceRecovery, detectResourceConflicts, detectWorkloadBalance, evaluateReadinessMatrix, simulateScenario, transitionServiceRecovery } from "../lib/operational-intelligence";

for (const domain of ["generic", "school", "hospital", "hotel"]) {
  const event = createOperationalEvent({ institutionId: domain, kind: "business", type: "queue.delay", occurredAt: "2026-01-01T00:00:00.000Z", payload: { load: 75 } });
  const load = calculateOperationalLoad({ institutionId: domain, domain, events: [event], now: "2026-01-01T00:01:00.000Z" });
  assert.equal(load.state, "constrained");
  assert.equal(buildOperationalCues([load])[0].lane, "NOW");
}
assert.equal(detectResourceConflicts({ institutionId: "i", demands: [{ demandId: "a", resourceId: "room", start: "10:00", end: "11:00" }, { demandId: "b", resourceId: "room", start: "10:30", end: "11:30" }] }).length, 1);
assert.equal(detectWorkloadBalance({ institutionId: "i", values: [{ subjectId: "a", load: 100 }, { subjectId: "b", load: 0 }] })[0].direction, "overloaded");
assert.equal(evaluateReadinessMatrix({ institutionId: "i", cells: [{ dimension: "data", status: "ready", reason: "verified", evidenceIds: ["e"] }] }).overall, "ready");
assert.equal(evaluateReadinessMatrix({ institutionId: "i", cells: [] }).overall, "unknown");
assert.equal(simulateScenario({ institutionId: "i", label: "Explicit scenario", scenario: "peak demand", assumptions: ["fixed staffing"], outcomes: ["queue grows"] }).explicitlyLabeled, true);
const recovery = createServiceRecovery({ institutionId: "i", serviceId: "dispatch", incident: "outage", startedAt: "2026-01-01T00:00:00.000Z" });
assert.equal(transitionServiceRecovery(recovery, "triaged", "owner reviewed").state, "triaged");
assert.throws(() => transitionServiceRecovery(recovery, "recovered", "skip"), /Invalid recovery transition/);
console.log("operational intelligence tests passed");
