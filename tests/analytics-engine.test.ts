import assert from "node:assert/strict";
import { createSnapshot, deterministicId, getMetric, metricRegistry } from "../lib/analytics";

const first = deterministicId("snap", { b: 2, a: 1 });
assert.equal(first, deterministicId("snap", { a: 1, b: 2 }), "IDs must be stable regardless of object key order");
assert.equal(metricRegistry.length >= 3, true);
assert.equal(getMetric("operations.task_completion_rate")?.aggregation, "ratio");

const snapshot = createSnapshot({
  metricId: "operations.task_completion_rate",
  institutionId: "institution-a",
  periodStart: "2026-01-01",
  periodEnd: "2026-01-07",
  value: null,
});
assert.equal(snapshot.status, "no_data");
assert.equal(snapshot.noDataReason, "no_records");
assert.equal(snapshot.lineage.institutionId, "institution-a");
assert.equal(snapshot.lineage.sourceCollection, "tasks");
assert.equal(snapshot.snapshotId, createSnapshot({ ...snapshot, value: 0 }).snapshotId);

console.log("analytics engine tests passed");
