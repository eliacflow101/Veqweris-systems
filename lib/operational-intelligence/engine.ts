import type { OperationalCause, OperationalCue, OperationalEvent, OperationalLoad, OperationalPriority, ReadinessCell, ReadinessMatrix, ResourceConflict, ResourceAlternative, ScenarioSimulation, ServiceRecovery, RecoveryState, WorkloadBalanceSignal } from "./models";
export * from "./models";

const stable = (value: unknown): string => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(stable).join(",")}]` : `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
export function deterministicId(prefix: string, value: unknown) { let h = 2166136261; for (const c of stable(value)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return `${prefix}_${(h >>> 0).toString(16).padStart(8, "0")}`; }
const priority = (score: number): OperationalPriority => score >= 90 ? "critical" : score >= 70 ? "high" : score >= 40 ? "medium" : "low";

export function createOperationalEvent(input: Omit<OperationalEvent, "eventId">): OperationalEvent {
  return { ...input, eventId: deterministicId("op_evt", { institutionId: input.institutionId, kind: input.kind, type: input.type, occurredAt: input.occurredAt, payload: input.payload }) };
}
export function classifyEvents(events: OperationalEvent[]) {
  return { business: events.filter((e) => e.kind === "business"), audit: events.filter((e) => e.kind === "audit"), telemetry: events.filter((e) => e.kind === "telemetry"), ui: events.filter((e) => e.kind === "ui") };
}
export function calculateOperationalLoad(input: { institutionId: string; domain: string; events: OperationalEvent[]; now?: string }): OperationalLoad {
  const events = input.events.filter((e) => e.institutionId === input.institutionId);
  const score = Math.min(100, events.reduce((sum, e) => sum + Number(e.payload.load ?? e.payload.severityScore ?? (e.kind === "telemetry" ? 10 : 5)), 0));
  const causes: OperationalCause[] = [...new Set(events.map((e) => e.type))].sort().map((code) => ({ code, label: code.replace(/[._-]/g, " "), weight: events.filter((e) => e.type === code).length, evidence: events.filter((e) => e.type === code).map((e) => e.eventId) }));
  const state = score >= 90 ? "blocked" : score >= 70 ? "constrained" : score >= 40 ? "elevated" : "normal";
  return { loadId: deterministicId("load", { institutionId: input.institutionId, domain: input.domain, events: events.map((e) => e.eventId) }), institutionId: input.institutionId, domain: input.domain, state, score, causes, measuredAt: input.now ?? new Date().toISOString(), evidenceEventIds: events.map((e) => e.eventId) };
}
export function buildOperationalCues(loads: OperationalLoad[], conflicts: ResourceConflict[] = []): OperationalCue[] {
  return loads.map((load): OperationalCue => ({ cueId: deterministicId("cue", load.loadId), lane: load.state === "normal" ? "NEXT" : load.state === "elevated" ? "ATTENTION" : "NOW", title: `${load.domain} load is ${load.state}`, detail: load.causes.map((c) => c.label).join(", ") || "No recorded causes", priority: priority(load.score), evidenceIds: load.evidenceEventIds })).concat(conflicts.map((c): OperationalCue => ({ cueId: deterministicId("cue", c.conflictId), lane: "NOW", title: `Resource conflict: ${c.resourceId}`, detail: `${c.demandIds.length} demands overlap`, priority: c.severity, evidenceIds: c.demandIds })));
}
export function evaluateReadinessMatrix(input: { institutionId: string; cells: ReadinessCell[]; evaluatedAt?: string }): ReadinessMatrix {
  const overall = input.cells.length === 0 ? "unknown" : input.cells.some((c) => c.status === "blocked") ? "blocked" : input.cells.some((c) => c.status === "unknown") ? "unknown" : input.cells.some((c) => c.status === "partial") ? "partial" : "ready";
  return { matrixId: deterministicId("ready", { institutionId: input.institutionId, cells: input.cells }), institutionId: input.institutionId, cells: input.cells, overall, evaluatedAt: input.evaluatedAt ?? new Date().toISOString() };
}
export function detectResourceConflicts(input: { institutionId: string; demands: Array<{ demandId: string; resourceId: string; start: string; end: string }>; alternatives?: Record<string, ResourceAlternative[]> }): ResourceConflict[] {
  const result: ResourceConflict[] = [];
  for (const demand of input.demands) {
    const overlap = input.demands.filter((other) => other.resourceId === demand.resourceId && other.demandId !== demand.demandId && other.start < demand.end && demand.start < other.end);
    if (overlap.length) { const demandIds = [demand.demandId, ...overlap.map((x) => x.demandId)].sort(); result.push({ conflictId: deterministicId("conflict", { resourceId: demand.resourceId, demandIds }), institutionId: input.institutionId, resourceId: demand.resourceId, windowStart: demand.start, windowEnd: demand.end, demandIds, alternatives: input.alternatives?.[demand.resourceId] ?? [], severity: "high" }); }
  }
  return result.filter((c, i, all) => all.findIndex((x) => x.conflictId === c.conflictId) === i);
}
export function detectWorkloadBalance(input: { institutionId: string; values: Array<{ subjectId: string; load: number; evidenceIds?: string[] }> }): WorkloadBalanceSignal[] {
  const average = input.values.length ? input.values.reduce((s, v) => s + v.load, 0) / input.values.length : 0;
  return input.values.map((v) => { const delta = v.load - average; return { signalId: deterministicId("balance", { institutionId: input.institutionId, subjectId: v.subjectId, load: v.load }), institutionId: input.institutionId, subjectId: v.subjectId, currentLoad: v.load, peerAverage: average, delta, direction: delta > 10 ? "overloaded" : delta < -10 ? "underloaded" : "balanced", evidenceIds: v.evidenceIds ?? [] }; });
}
export function simulateScenario(input: { institutionId: string; label: string; scenario: string; assumptions: string[]; outcomes: string[]; generatedAt?: string }): ScenarioSimulation { return { ...input, simulationId: deterministicId("sim", input), explicitlyLabeled: true, generatedAt: input.generatedAt ?? new Date().toISOString() }; }
const transitions: Record<RecoveryState, RecoveryState[]> = { detected: ["triaged"], triaged: ["mitigating"], mitigating: ["monitoring", "recovered"], monitoring: ["recovered", "mitigating"], recovered: ["closed"], closed: [] };
export function transitionServiceRecovery(recovery: ServiceRecovery, next: RecoveryState, note: string, at = new Date().toISOString()): ServiceRecovery { if (!transitions[recovery.state].includes(next)) throw new Error(`Invalid recovery transition: ${recovery.state} -> ${next}`); return { ...recovery, state: next, updatedAt: at, timeline: [...recovery.timeline, { state: next, at, note }] }; }
export function createServiceRecovery(input: Omit<ServiceRecovery, "recoveryId" | "timeline" | "state" | "updatedAt"> & { now?: string }): ServiceRecovery { const at = input.now ?? input.startedAt; const { now: _now, ...rest } = input; return { ...rest, recoveryId: deterministicId("recovery", input), state: "detected", updatedAt: at, timeline: [{ state: "detected", at, note: input.incident }] }; }
