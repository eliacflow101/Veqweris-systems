import type { AuditEvent, BreakGlassAccess, DataConflict, DataQualityIssue, Finding, FindingStatus, GovernanceChain, GovernanceStage, Provenance } from "./models";

const findingOrder: FindingStatus[] = ["open", "acknowledged", "in_progress", "pending_verification", "verified", "closed"];
const stable = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
};

export function deterministicId(prefix: string, value: unknown): string {
  let hash = 2166136261;
  for (const character of stable(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createGovernanceChain(input: Omit<GovernanceChain, "chainId" | "updatedAt"> & { updatedAt?: string }): GovernanceChain {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  return { ...input, chainId: deterministicId("gov", { institutionId: input.institutionId, requirementId: input.requirementId }), updatedAt };
}

export function transitionFinding(finding: Finding, next: FindingStatus, now = new Date().toISOString()): Finding {
  if (next === finding.status) return { ...finding, updatedAt: now };
  if (next === "rejected" && ["open", "acknowledged"].includes(finding.status)) return { ...finding, status: next, updatedAt: now, version: finding.version + 1 };
  const currentIndex = findingOrder.indexOf(finding.status);
  const nextIndex = findingOrder.indexOf(next);
  if (currentIndex < 0 || nextIndex !== currentIndex + 1) throw new Error(`Invalid finding transition: ${finding.status} -> ${next}`);
  return { ...finding, status: next, updatedAt: now, version: finding.version + 1 };
}

export function createAuditEvent(input: Omit<AuditEvent, "hash">): AuditEvent {
  return { ...input, hash: deterministicId("evt", { ...input, hash: undefined }) };
}

export function verifyAuditChain(events: AuditEvent[]): boolean {
  return events.every((event, index) => {
    const previous = events[index - 1];
    const { hash: _hash, ...eventWithoutHash } = event;
    return event.sequence === index && event.previousHash === (previous?.hash ?? null)
      && event.hash === createAuditEvent(eventWithoutHash).hash;
  });
}

export function createProvenance(input: Omit<Provenance, "provenanceId">): Provenance {
  return { ...input, provenanceId: deterministicId("prov", input) };
}

export function detectDataQualityIssues<T extends Record<string, unknown>>(input: {
  institutionId: string; entityType: string; records: Array<T & { id?: string; updatedAt?: string }>; requiredFields?: string[]; staleBefore?: string;
}): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  const now = new Date().toISOString();
  input.records.forEach((record, index) => {
    const entityId = String(record.id ?? index);
    const missing = (input.requiredFields ?? []).filter((field) => record[field] === undefined || record[field] === null || record[field] === "");
    if (missing.length) issues.push({ issueId: deterministicId("dq", { entityId, code: "missing_required", fields: missing }), institutionId: input.institutionId, entityType: input.entityType, entityId, code: "missing_required", fields: missing, message: `Required fields are missing: ${missing.join(", ")}`, detectedAt: now, severity: "error" });
    if (input.staleBefore && record.updatedAt && record.updatedAt < input.staleBefore) issues.push({ issueId: deterministicId("dq", { entityId, code: "stale" }), institutionId: input.institutionId, entityType: input.entityType, entityId, code: "stale", fields: ["updatedAt"], message: "Record is stale.", detectedAt: now, severity: "warning" });
  });
  return issues;
}

export function detectConflicts(input: { institutionId: string; entityType: string; records: Array<Record<string, unknown> & { id?: string }>; fields: string[] }): DataConflict[] {
  const conflicts: DataConflict[] = [];
  for (const field of input.fields) {
    const groups = new Map<string, Array<Record<string, unknown> & { id?: string }>>();
    input.records.forEach((record) => { const value = record[field]; if (value !== undefined && value !== null) { const key = stable(value); groups.set(key, [...(groups.get(key) ?? []), record]); } });
    if (groups.size > 1) conflicts.push({ conflictId: deterministicId("conf", { entityType: input.entityType, field, records: input.records.map((r) => r.id) }), institutionId: input.institutionId, entityType: input.entityType, entityId: String(input.records[0]?.id ?? "set"), field, values: [...groups.keys()].map((key) => JSON.parse(key)), sourceIds: input.records.map((r) => String(r.id ?? "")), status: "open", detectedAt: new Date().toISOString() });
  }
  return conflicts;
}

export function createBreakGlassAccess(input: { institutionId: string; uid: string; reason: string; scope: string[]; grantedBy: string; durationMinutes: number; now?: string }): BreakGlassAccess {
  if (!input.reason.trim() || input.durationMinutes < 1 || input.durationMinutes > 240) throw new Error("Break-glass access requires a reason and a duration from 1 to 240 minutes.");
  const grantedAt = input.now ?? new Date().toISOString();
  return { accessId: deterministicId("bg", { institutionId: input.institutionId, uid: input.uid, grantedAt }), institutionId: input.institutionId, uid: input.uid, reason: input.reason.trim(), scope: input.scope, grantedBy: input.grantedBy, grantedAt, expiresAt: new Date(new Date(grantedAt).getTime() + input.durationMinutes * 60000).toISOString(), status: "active" };
}

export function isBreakGlassActive(access: BreakGlassAccess, now = new Date()): boolean {
  return access.status === "active" && !access.revokedAt && new Date(access.expiresAt).getTime() > now.getTime();
}

export function governanceStages(): GovernanceStage[] {
  return ["Requirement", "Policy", "Department", "Training", "Audit", "Finding", "Corrective Action", "Verification"];
}
