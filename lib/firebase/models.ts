/** Canonical workspace roles. Vertical-specific roles remain user roles, not a second identity model. */
export type UserRole =
  | "Owner" | "Admin" | "Manager" | "Employee"
  | "Clinician" | "Nurse" | "Reception" | "Billing"
  | "Laboratory" | "Pharmacist";

export interface Institution {
  institutionId: string;
  name: string;
  country: string;
  status: "active";
  planTier: "trial";
  createdAt: unknown;
  location?: string;
}

export interface PlannerEvent {
  eventId: string;
  institutionId: string;
  departmentId: string | null;
  title: string;
  description: string;
  startTime: unknown;
  endTime: unknown;
  location?: string;
  createdBy: string;
  attendees?: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  phone?: string;
  photoUrl?: string;
  institutionId: string;
  departmentId: string | null;
  lastActive: unknown;
  role: UserRole;
  specialtyId?: string | null;
  specialtyIds?: string[];
  assignedPatientIds?: string[];
  healthcarePermissions?: string[];
  status: "active" | "inactive";
  createdAt: unknown;
  securityStatus?: "standard" | "review" | "locked" | "compromised";
  recoveryFactors?: string[];
  preferences?: UserPreferences;
  sessionPolicy?: SessionPolicy;
}

export type SessionPolicy = "browser_close" | "1_day" | "7_days" | "30_days";
export type LockTimeout = "never" | "5_minutes" | "10_minutes" | "15_minutes" | "30_minutes" | "60_minutes";

export interface UserPreferences {
  theme?: "dark" | "light";
  language?: string;
  timezone?: string;
  notificationPreferences?: {
    email?: boolean;
    push?: boolean;
    taskReminders?: boolean;
    plannerAlerts?: boolean;
    securityAlerts?: boolean;
  };
  dateFormat?: string;
  timeFormat?: "12h" | "24h";
  density?: "comfortable" | "compact";
  updatedAt?: unknown;
}

export type SecurityEventType =
  | "login"
  | "logout"
  | "failed_login"
  | "password_change"
  | "recovery_request"
  | "recovery_completion"
  | "workspace_lock"
  | "workspace_unlock"
  | "sensitive_action"
  | "role_change"
  | "account_deactivation"
  | "account_reactivation"
  | "session_revocation";

export interface SecurityEvent {
  eventId: string;
  institutionId: string;
  uid: string | null;
  type: SecurityEventType;
  source: string;
  details?: Record<string, unknown>;
  createdAt: unknown;
}

export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";

export interface Department {
  departmentId: string;
  institutionId: string;
  name: string;
  departmentCode: string;
  headUserId: string | null;
  description: string;
  status: "active" | "inactive";
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Task {
  taskId: string;
  institutionId: string;
  departmentId: string;
  title: string;
  description: string;
  assignedTo: string;
  assignedBy: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

export type ConversationType = "direct" | "department" | "institution_wide";

export interface Conversation {
  conversationId: string;
  institutionId: string;
  participantIds: string[];
  type: ConversationType;
  title?: string;
  departmentId?: string | null;
  lastMessagePreview?: string;
  lastMessageAt?: unknown;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Message {
  messageId: string;
  conversationId: string;
  institutionId: string;
  senderId: string;
  text: string;
  type: "text" | "call_link";
  callUrl?: string;
  createdAt: unknown;
}

export type WorkforceRole = UserRole | "Operator" | "Service Worker" | "Department Head";

export type DuplicateState = "New" | "Existing Match" | "Possible Duplicate" | "Conflict" | "Missing Identifier" | "Needs Review";

export interface OperationalAccessProfile {
  terminalId: string;
  institutionId: string;
  label: string;
  scope: "Storekeeper Terminal" | "Finance Terminal" | "Reception Terminal" | "Teacher Terminal" | "Librarian Terminal" | "Kitchen Terminal" | "Pharmacy Terminal";
  allowedPages: string[];
  allowedActions: string[];
  departmentScope: string[];
  moduleScope: string[];
  sessionMinutes?: number;
  autoLockSeconds?: number;
  requiresReauthForSensitiveActions?: boolean;
  revokedAt?: unknown;
  status: "active" | "revoked" | "limited";
  createdAt: unknown;
}

export interface BulkImportCandidate {
  rowId: string;
  institutionEmployeeId?: string;
  fullName: string;
  officialEmail: string;
  phone?: string;
  department?: string;
  role?: string;
  position?: string;
  employmentType?: string;
  status?: string;
  duplicateState?: DuplicateState;
  issues?: string[];
}

export type ApprovalStatus =
  | "Draft"
  | "Submitted"
  | "Under Review"
  | "Approved"
  | "Rejected"
  | "Returned"
  | "Cancelled"
  | "Expired";

export type ApprovalPriority = "low" | "medium" | "high";
export type ApprovalSensitivity = "public" | "internal" | "confidential" | "restricted";
export type ApprovalRisk = "low" | "medium" | "high";

export interface ApprovalAuditEntry {
  eventId: string;
  actorUid: string;
  actorRole?: string;
  previousStatus: ApprovalStatus;
  newStatus: ApprovalStatus;
  action: string;
  reason?: string;
  comments?: string;
  evidence?: string[];
  createdAt: unknown;
}

export interface ApprovalRecord {
  approvalId: string;
  institutionId: string;
  module: string;
  departmentId?: string | null;
  title: string;
  requesterUid: string;
  requesterName?: string;
  approverUid?: string | null;
  assigneeUid?: string | null;
  status: ApprovalStatus;
  priority: ApprovalPriority;
  sensitivity: ApprovalSensitivity;
  risk: ApprovalRisk;
  amount?: number | null;
  action: string;
  reason?: string;
  comments?: string;
  evidence?: string[];
  workflow: string;
  approvalAuthority?: string;
  previousStatus?: ApprovalStatus | null;
  createdAt: unknown;
  updatedAt: unknown;
  auditTrail?: ApprovalAuditEntry[];
  relatedTaskId?: string | null;
}

export type DocumentStatus =
  | "UPLOADED"
  | "QUEUED"
  | "PROCESSING"
  | "EXTRACTED"
  | "NEEDS_REVIEW"
  | "VALIDATED"
  | "VERIFIED"
  | "AVAILABLE"
  | "FAILED"
  | "UNSUPPORTED"
  | "REJECTED";

export interface DocumentRecord {
  documentId: string;
  institutionId: string;
  name: string;
  type: string; // e.g. "policy", "invoice"
  mimeType: string;
  size: number;
  storagePath: string; // path in Firebase Storage
  uploadedBy: string;
  uploadedAt: unknown;
  status: DocumentStatus;
  version: number;
  source?: string | null;
  module?: string | null;
  entityRef?: { collection: string; id: string } | null;
  departmentId?: string | null;
  classification?: string | null;
  retentionPolicy?: string | null;
  checksum?: string | null;
  allowedViewers?: string[]; // optional explicit user ids allowed
  updatedAt?: unknown;
}

export interface BulkImportBatchRow {
  rowId: string;
  institutionEmployeeId?: string;
  fullName: string;
  officialEmail: string;
  phone?: string;
  department?: string;
  role?: string;
  position?: string;
  employmentType?: string;
  status?: string;
  duplicateState?: DuplicateState;
  issues?: string[];
  allowed?: boolean;
}

export interface BulkImportBatchRecord {
  batchId: string;
  institutionId: string;
  createdBy: string;
  fileName: string;
  sourceType: "csv" | "xlsx" | "xls";
  status: "pending_review" | "confirmed" | "created" | "rejected";
  rows: BulkImportBatchRow[];
  validCount: number;
  rejectedCount: number;
  createdAt: unknown;
  updatedAt: unknown;
}
