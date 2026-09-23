export type OperationalEventKind = "business" | "audit" | "telemetry" | "ui";
export type OperationalLoadState = "Normal" | "Elevated" | "High" | "Critical";
export type OperationalPriority = "low" | "medium" | "high" | "critical";
export type OperationalLane = "NOW" | "NEXT" | "ATTENTION";
export type ReadinessStatus = "ready" | "partial" | "blocked" | "unknown";
export type RecoveryState = "detected" | "triaged" | "mitigating" | "monitoring" | "recovered" | "closed";
export type OperationalFlowStage = "EVENT" | "INTELLIGENCE" | "WORKFLOW" | "TASK" | "NOTIFICATION" | "EXCEPTION" | "HUMAN_ACTION" | "VERIFICATION" | "AUDIT" | "ANALYTICS";
export type ResourceConflictType = "person" | "room" | "equipment" | "capacity" | "time";
export type ScenarioType = "demand_spike" | "staff_absence" | "resource_outage" | "capacity_reduction" | "service_recovery";

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
  workload: number;
  queueSize: number;
  waitingTimeMinutes: number;
  overdueTasks: number;
  unresolvedExceptions: number;
  availableStaff: number;
  resourceCapacity: number;
  pendingWork: number;
}
export interface OperationalFlowRecord { flowId: string; institutionId: string; sourceEventId: string; stage: OperationalFlowStage; linkedId: string; evidenceIds: string[]; occurredAt: string; }
export interface OperationalCue { cueId: string; lane: OperationalLane; title: string; detail: string; priority: OperationalPriority; evidenceIds: string[]; }
export interface ReadinessCell { dimension: string; status: ReadinessStatus; reason: string; evidenceIds: string[]; }
export interface ReadinessMatrix { matrixId: string; institutionId: string; cells: ReadinessCell[]; overall: ReadinessStatus; evaluatedAt: string; }
export interface ResourceAlternative { resourceId: string; label: string; reason: string; }
export interface ResourceConflict { conflictId: string; institutionId: string; resourceId: string; type: ResourceConflictType; windowStart: string; windowEnd: string; demandIds: string[]; alternatives: ResourceAlternative[]; severity: OperationalPriority; }
export interface WorkloadBalanceSignal { signalId: string; institutionId: string; subjectId: string; currentLoad: number; peerAverage: number; delta: number; direction: "underloaded" | "balanced" | "overloaded"; evidenceIds: string[]; }
export interface ScenarioSimulation { simulationId: string; institutionId: string; label: string; type: ScenarioType; scenario: string; assumptions: string[]; outcomes: string[]; explicitlyLabeled: true; generatedAt: string; }
export interface ServiceRecovery {
  recoveryId: string; institutionId: string; serviceId: string; state: RecoveryState;
  issue: string; responsibleUnit: string; investigation: string; cause: string; correctiveAction: string; owner: string; deadline: string; resolution: string; verification: string; closed: boolean;
  incident: string; startedAt: string; updatedAt: string; ownerUid?: string;
  timeline: Array<{ state: RecoveryState; at: string; note: string }>;
}
