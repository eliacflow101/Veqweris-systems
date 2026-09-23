export type NetworkTrustState = "Registered" | "Verified" | "Trusted Network Member" | "Enterprise Partner" | "Restricted" | "Suspended" | "Revoked";
export type NetworkParticipation = "open" | "invite_only" | "not_accepting";
export type AssistanceRequestState = "Draft" | "Submitted" | "Under Review" | "Accepted" | "Declined" | "Clarification Required" | "In Progress" | "Completed" | "Cancelled" | "Expired";
export type ContractState = "pending_approval" | "active" | "expired" | "revoked";
export type NetworkScope = "assistance" | "service_directory" | "workspace_records";

/** Deliberately contains no employees, patients, finances, tasks, analytics, documents, or security data. */
export interface NetworkProfile {
  institutionId: string;
  institutionName: string;
  broadLocation: string;
  selectedServices: string[];
  participation: NetworkParticipation;
  contactEnabled: boolean;
  trustState: NetworkTrustState;
  updatedAt: string;
}

export interface AssistanceRequest {
  requestId: string;
  requesterInstitutionId: string;
  requestedInstitutionId: string;
  requestedBy: string;
  subject: string;
  description: string;
  requestedScope: NetworkScope;
  state: AssistanceRequestState;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface NetworkMembership {
  membershipId: string;
  institutionId: string;
  memberInstitutionId: string;
  status: "pending" | "active" | "suspended" | "revoked";
  joinedAt?: string;
  revokedAt?: string;
}

export interface DataSharingPermission {
  permissionId: string;
  contractId: string;
  institutionId: string;
  counterpartyInstitutionId: string;
  scopes: NetworkScope[];
  records: string[];
  users: string[];
  status: "active" | "revoked";
  grantedAt: string;
  revokedAt?: string;
}

export interface CollaborationContract {
  contractId: string;
  institutionAId: string;
  institutionBId: string;
  initiatedByInstitutionId: string;
  status: ContractState;
  scopes: NetworkScope[];
  records: string[];
  users: string[];
  startsAt: string;
  endsAt: string;
  approvedBy: Partial<Record<string, string>>;
  approvedAt: Partial<Record<string, string>>;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  revokedBy?: string;
}

export interface NetworkWorkspaceRecord {
  recordId: string;
  contractId: string;
  ownerInstitutionId: string;
  recordType: string;
  scope: NetworkScope;
  title: string;
  body: string;
  createdBy: string;
  createdAt: string;
  retainedUntil?: string;
}
