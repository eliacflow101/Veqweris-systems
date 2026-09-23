import assert from "node:assert/strict";
import { createAuditEvent, createBreakGlassAccess, detectConflicts, detectDataQualityIssues, isBreakGlassActive, transitionFinding, verifyAuditChain } from "../lib/governance";
import type { Finding } from "../lib/governance";

const first = createAuditEvent({ eventId: "1", institutionId: "i", actorUid: "u", action: "create", resourceType: "finding", resourceId: "f", payload: { b: 2, a: 1 }, occurredAt: "2026-01-01T00:00:00.000Z", previousHash: null, sequence: 0 });
const second = createAuditEvent({ eventId: "2", institutionId: "i", actorUid: "u", action: "update", resourceType: "finding", resourceId: "f", payload: {}, occurredAt: "2026-01-01T00:01:00.000Z", previousHash: first.hash, sequence: 1 });
assert.equal(verifyAuditChain([first, second]), true);
assert.equal(verifyAuditChain([{ ...second, previousHash: null }, first]), false);

const finding: Finding = { findingId: "f", institutionId: "i", auditId: "a", title: "Check", description: "Check", severity: "high", status: "open", evidenceIds: [], createdAt: "2026-01-01", updatedAt: "2026-01-01", version: 1 };
assert.equal(transitionFinding(finding, "acknowledged").status, "acknowledged");
assert.throws(() => transitionFinding(finding, "closed"), /Invalid finding transition/);
assert.equal(detectDataQualityIssues({ institutionId: "i", entityType: "policy", records: [{ id: "p" }], requiredFields: ["title"] }).length, 1);
assert.equal(detectConflicts({ institutionId: "i", entityType: "x", records: [{ id: "1", owner: "a" }, { id: "2", owner: "b" }], fields: ["owner"] }).length, 1);
const access = createBreakGlassAccess({ institutionId: "i", uid: "u", grantedBy: "admin", reason: "Urgent incident", scope: ["records"], durationMinutes: 30, now: "2026-01-01T00:00:00.000Z" });
assert.equal(isBreakGlassActive(access, new Date("2026-01-01T00:15:00.000Z")), true);
assert.equal(isBreakGlassActive(access, new Date("2026-01-01T01:00:00.000Z")), false);
assert.throws(() => createBreakGlassAccess({ institutionId: "i", uid: "u", grantedBy: "admin", reason: "", scope: [], durationMinutes: 30 }), /requires a reason/);
console.log("governance engine tests passed");
