import type { UserProfile } from "@/lib/firebase/models";

export type ApprovalStatus =
  | "Draft"
  | "Submitted"
  | "Under Review"
  | "Approved"
  | "Rejected"
  | "Returned"
  | "Cancelled"
  | "Expired";

export type WorkflowPriority = "low" | "medium" | "high";
export type WorkflowSensitivity = "public" | "internal" | "confidential" | "restricted";
export type WorkflowRisk = "low" | "medium" | "high";

export type ApprovalAuditEntry = {
  eventId: string;
  actorUid: string;
  actorRole?: string;
  previousStatus: ApprovalStatus;
  newStatus: ApprovalStatus;
  action: string;
  reason?: string;
  comments?: string;
  evidence?: string[];
  createdAt: string;
};

export type WorkflowTransition = {
  from: ApprovalStatus;
  to: ApprovalStatus;
  action: string;
  allowedRoles?: Array<"Owner" | "Admin" | "Manager" | "Employee">;
  requiresDepartment?: boolean;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  defaultApproverRole: "Owner" | "Admin" | "Manager" | "Employee";
  states: ApprovalStatus[];
  transitions: WorkflowTransition[];
};

export const approvalStatuses: ApprovalStatus[] = [
  "Draft",
  "Submitted",
  "Under Review",
  "Approved",
  "Rejected",
  "Returned",
  "Cancelled",
  "Expired",
];

export const workflowDefinitions: Record<string, WorkflowDefinition> = {
  general: {
    id: "general",
    name: "General approval",
    defaultApproverRole: "Manager",
    states: approvalStatuses,
    transitions: [
      { from: "Draft", to: "Submitted", action: "submit", allowedRoles: ["Owner", "Admin", "Manager", "Employee"] },
      { from: "Submitted", to: "Under Review", action: "review", allowedRoles: ["Owner", "Admin", "Manager"] },
      { from: "Under Review", to: "Approved", action: "approve", allowedRoles: ["Owner", "Admin", "Manager"] },
      { from: "Under Review", to: "Rejected", action: "reject", allowedRoles: ["Owner", "Admin", "Manager"] },
      { from: "Under Review", to: "Returned", action: "return", allowedRoles: ["Owner", "Admin", "Manager"] },
      { from: "Approved", to: "Expired", action: "expire", allowedRoles: ["Owner", "Admin"] },
      { from: "Submitted", to: "Cancelled", action: "cancel", allowedRoles: ["Owner", "Admin", "Manager", "Employee"] },
      { from: "Returned", to: "Submitted", action: "resubmit", allowedRoles: ["Owner", "Admin", "Manager", "Employee"] },
    ],
  },
  finance: {
    id: "finance",
    name: "Finance approval",
    defaultApproverRole: "Admin",
    states: approvalStatuses,
    transitions: [
      { from: "Draft", to: "Submitted", action: "submit", allowedRoles: ["Owner", "Admin", "Manager", "Employee"] },
      { from: "Submitted", to: "Under Review", action: "review", allowedRoles: ["Owner", "Admin", "Manager"] },
      { from: "Under Review", to: "Approved", action: "approve", allowedRoles: ["Owner", "Admin"] },
      { from: "Under Review", to: "Rejected", action: "reject", allowedRoles: ["Owner", "Admin"] },
      { from: "Under Review", to: "Returned", action: "return", allowedRoles: ["Owner", "Admin"] },
    ],
  },
  documents: {
    id: "documents",
    name: "Document release approval",
    defaultApproverRole: "Manager",
    states: approvalStatuses,
    transitions: [
      { from: "Draft", to: "Submitted", action: "submit", allowedRoles: ["Owner", "Admin", "Manager", "Employee"] },
      { from: "Submitted", to: "Under Review", action: "review", allowedRoles: ["Owner", "Admin", "Manager"] },
      { from: "Under Review", to: "Approved", action: "approve", allowedRoles: ["Owner", "Admin", "Manager"] },
      { from: "Under Review", to: "Rejected", action: "reject", allowedRoles: ["Owner", "Admin", "Manager"] },
      { from: "Under Review", to: "Returned", action: "return", allowedRoles: ["Owner", "Admin", "Manager"] },
    ],
  },
  inventory: {
    id: "inventory",
    name: "Inventory approval",
    defaultApproverRole: "Manager",
    states: approvalStatuses,
    transitions: [
      { from: "Draft", to: "Submitted", action: "submit", allowedRoles: ["Owner", "Admin", "Manager"] },
      { from: "Submitted", to: "Under Review", action: "review", allowedRoles: ["Owner", "Admin", "Manager"] },
      { from: "Under Review", to: "Approved", action: "approve", allowedRoles: ["Owner", "Admin", "Manager"] },
      { from: "Under Review", to: "Rejected", action: "reject", allowedRoles: ["Owner", "Admin", "Manager"] },
      { from: "Under Review", to: "Returned", action: "return", allowedRoles: ["Owner", "Admin", "Manager"] },
    ],
  },
};

export function getWorkflowDefinition(module: string) {
  return workflowDefinitions[module] ?? workflowDefinitions.general;
}

export function getAllowedTransitions(status: ApprovalStatus, module: string) {
  const workflow = getWorkflowDefinition(module);
  return workflow.transitions.filter((item) => item.from === status);
}

export function canTransitionStatus(status: ApprovalStatus, nextStatus: ApprovalStatus, module: string, userRole?: string) {
  const workflow = getWorkflowDefinition(module);
  const match = workflow.transitions.find((item) => item.from === status && item.to === nextStatus);
  if (!match) return false;
  if (!userRole) return true;
  if (!match.allowedRoles) return true;
  return match.allowedRoles.includes(userRole as "Owner" | "Admin" | "Manager" | "Employee");
}

export function buildApprovalAuditEntry({
  actorUid,
  actorRole,
  previousStatus,
  newStatus,
  action,
  reason,
  comments,
  evidence,
}: {
  actorUid: string;
  actorRole?: string;
  previousStatus: ApprovalStatus;
  newStatus: ApprovalStatus;
  action: string;
  reason?: string;
  comments?: string;
  evidence?: string[];
}): ApprovalAuditEntry {
  return {
    eventId: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    actorUid,
    actorRole,
    previousStatus,
    newStatus,
    action,
    reason,
    comments,
    evidence: evidence ?? [],
    createdAt: new Date().toISOString(),
  };
}

export function buildApprovalTask(seed: {
  institutionId: string;
  title: string;
  description: string;
  departmentId: string | null;
  assignedTo: string;
  priority: "low" | "medium" | "high";
  dueInDays?: number;
}) {
  const dueDate = new Date(Date.now() + (seed.dueInDays ?? 3) * 24 * 60 * 60 * 1000).toISOString();
  return {
    title: seed.title,
    description: seed.description,
    departmentId: seed.departmentId ?? "shared",
    assignedTo: seed.assignedTo,
    priority: seed.priority,
    dueDate,
    status: "todo" as const,
  };
}

export function seedApprovalExamples(institutionId: string, user: UserProfile) {
  const payload = [
    {
      approvalId: "approval-general-001",
      institutionId,
      module: "general",
      departmentId: user.departmentId ?? "department-a",
      title: "Quarterly operational change",
      requesterUid: user.uid,
      requesterName: user.fullName,
      approverUid: user.uid,
      assigneeUid: user.uid,
      status: "Submitted" as ApprovalStatus,
      priority: "high" as const,
      sensitivity: "confidential" as const,
      risk: "medium" as const,
      amount: 12400,
      action: "Submit the Q3 operational change request",
      reason: "Control validation for the quarterly operating cadence",
      comments: "Awaiting review.",
      evidence: ["ops-change.pdf"],
      workflow: "general",
      approvalAuthority: "Owner",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditTrail: [buildApprovalAuditEntry({
        actorUid: user.uid,
        actorRole: user.role,
        previousStatus: "Draft",
        newStatus: "Submitted",
        action: "submit",
        reason: "Initial submission",
      })],
    },
    {
      approvalId: "approval-documents-001",
      institutionId,
      module: "documents",
      departmentId: user.departmentId ?? "department-a",
      title: "Policy release approval",
      requesterUid: user.uid,
      requesterName: user.fullName,
      approverUid: user.uid,
      assigneeUid: user.uid,
      status: "Under Review" as ApprovalStatus,
      priority: "medium" as const,
      sensitivity: "internal" as const,
      risk: "low" as const,
      amount: 0,
      action: "Release policy package",
      reason: "Quarterly compliance package needs approval before publication.",
      comments: "Review team has the package.",
      evidence: ["policy-pack.zip"],
      workflow: "documents",
      approvalAuthority: "Manager",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      auditTrail: [buildApprovalAuditEntry({
        actorUid: user.uid,
        actorRole: user.role,
        previousStatus: "Submitted",
        newStatus: "Under Review",
        action: "review",
      })],
    },
  ];

  return payload;
}
