export type GovernanceStage = "Requirement" | "Policy" | "Department" | "Training" | "Audit" | "Finding" | "Corrective Action" | "Verification";
export type FindingStatus = "open" | "acknowledged" | "in_progress" | "pending_verification" | "verified" | "closed" | "rejected";
export type FindingSeverity = "low" | "medium" | "high" | "critical";

export interface EvidenceRecord {
  evidenceId: string;
  institutionId: string;
  stage: GovernanceStage;
  title: string;
  description?: string;
  sourceCollection: string;
  sourceId: string;
  checksum?: string;
  capturedAt: string;
  capturedBy: string;
  retentionUntil?: string;
  supersedesEvidenceId?: string;
}

export interface GovernanceChain {
  chainId: string;
  institutionId: string;
  requirementId: string;
  policyId?: string;
  departmentId?: string;
  trainingId?: string;
  auditId?: string;
  findingId?: string;
  correctiveActionId?: string;
  verificationId?: string;
  evidenceIds: string[];
  updatedAt: string;
}

export interface Finding {
  findingId: string;
  institutionId: string;
  auditId: string;
  departmentId?: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  status: FindingStatus;
  ownerUid?: string;
  dueAt?: string;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AuditEvent {
  eventId: string;
  institutionId: string;
  actorUid: string;
  action: string;
  resourceType: string;
  resourceId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  previousHash: string | null;
  hash: string;
  sequence: number;
}

export interface Provenance {
  provenanceId: string;
  institutionId: string;
  entityType: string;
  entityId: string;
  sourceCollection: string;
  sourceId: string;
  sourceVersion?: string;
  capturedAt: string;
  capturedBy: string;
  transformations: string[];
  checksum?: string;
}

export interface DataQualityIssue {
  issueId: string;
  institutionId: string;
  entityType: string;
  entityId: string;
  code: "missing_required" | "invalid_type" | "duplicate" | "stale" | "conflict";
  fields: string[];
  message: string;
  detectedAt: string;
  severity: "warning" | "error";
}

export interface DataConflict {
  conflictId: string;
  institutionId: string;
  entityType: string;
  entityId: string;
  field: string;
  values: unknown[];
  sourceIds: string[];
  status: "open" | "resolved";
  detectedAt: string;
}

export interface BreakGlassAccess {
  accessId: string;
  institutionId: string;
  uid: string;
  reason: string;
  scope: string[];
  grantedBy: string;
  grantedAt: string;
  expiresAt: string;
  revokedAt?: string;
  status: "active" | "expired" | "revoked";
}
