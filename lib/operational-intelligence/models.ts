export type OperationalEventKind = "business" | "audit" | "telemetry" | "ui";
export type OperationalLoadState = "normal" | "elevated" | "constrained" | "blocked" | "recovering";
export type OperationalPriority = "low" | "medium" | "high" | "critical";
export type OperationalLane = "NOW" | "NEXT" | "ATTENTION";
export type ReadinessStatus = "ready" | "partial" | "blocked" | "unknown";
export type RecoveryState = "detected" | "triaged" | "mitigating" | "monitoring" | "recovered" | "closed";

export interface OperationalEvent {
  eventId: string;
  institutionId: string;
  kind: OperationalEventKind;
  type: string;
  actorUid?: string;
  departmentId?: string;
  resourceId?: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  sensitivity?: "public" | "internal" | "confidential" | "restricted";
}

export interface OperationalCause { code: string; label: string; weight: number; evidence: string[]; }
export interface OperationalLoad {
  loadId: string;
  institutionId: string;
  domain: string;
  state: OperationalLoadState;
  score: number;
  causes: OperationalCause[];
  measuredAt: string;
  evidenceEventIds: string[];
}
export interface OperationalCue { cueId: string; lane: OperationalLane; title: string; detail: string; priority: OperationalPriority; evidenceIds: string[]; }
export interface ReadinessCell { dimension: string; status: ReadinessStatus; reason: string; evidenceIds: string[]; }
export interface ReadinessMatrix { matrixId: string; institutionId: string; cells: ReadinessCell[]; overall: ReadinessStatus; evaluatedAt: string; }
export interface ResourceAlternative { resourceId: string; label: string; reason: string; }
export interface ResourceConflict { conflictId: string; institutionId: string; resourceId: string; windowStart: string; windowEnd: string; demandIds: string[]; alternatives: ResourceAlternative[]; severity: OperationalPriority; }
export interface WorkloadBalanceSignal { signalId: string; institutionId: string; subjectId: string; currentLoad: number; peerAverage: number; delta: number; direction: "underloaded" | "balanced" | "overloaded"; evidenceIds: string[]; }
export interface ScenarioSimulation { simulationId: string; institutionId: string; label: string; scenario: string; assumptions: string[]; outcomes: string[]; explicitlyLabeled: true; generatedAt: string; }
export interface ServiceRecovery {
  recoveryId: string; institutionId: string; serviceId: string; state: RecoveryState;
  incident: string; startedAt: string; updatedAt: string; ownerUid?: string;
  timeline: Array<{ state: RecoveryState; at: string; note: string }>;
}
