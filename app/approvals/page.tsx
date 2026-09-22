"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/shared/section-heading";
import { useAuth } from "@/lib/auth-context";
import { saveApproval, updateApprovalStatus, useApprovals, useDepartments, useEmployees } from "@/lib/firebase/data";
import type { ApprovalRecord, ApprovalStatus } from "@/lib/firebase/models";
import { seedApprovalExamples } from "@/lib/workflow-engine";

const tabs = ["Inbox", "My Approvals", "Submitted", "Returned", "Approved", "Rejected", "History"] as const;
type ApprovalTab = (typeof tabs)[number];

const statusStyles: Record<ApprovalStatus | "all", string> = {
  all: "border-line/80 bg-surface-raised text-muted",
  Draft: "border-warning/60 bg-warning/10 text-warning",
  Submitted: "border-accent/60 bg-accent/10 text-accent",
  "Under Review": "border-info/60 bg-info/10 text-info",
  Approved: "border-success/60 bg-success/10 text-success",
  Rejected: "border-danger/60 bg-danger/10 text-danger",
  Returned: "border-warning/60 bg-warning/10 text-warning",
  Cancelled: "border-muted/60 bg-muted/10 text-muted",
  Expired: "border-muted/60 bg-muted/10 text-muted",
};

const defaultFilters = { module: "all", department: "all", requester: "all", status: "all", priority: "all", sensitivity: "all" };

export default function ApprovalsPage() {
  const { profile } = useAuth();
  const { data: approvals = [], loading } = useApprovals(profile?.institutionId);
  const { data: departments = [] } = useDepartments(profile?.institutionId);
  const { data: employees = [] } = useEmployees(profile?.institutionId);
  const [tab, setTab] = useState<ApprovalTab>("Inbox");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(defaultFilters);
  const [seeding, setSeeding] = useState(false);

  const departmentLookup = new Map(departments.map((department) => [department.departmentId, department.name]));
  const employeeLookup = new Map(employees.map((employee) => [employee.uid, employee.fullName]));

  const visibleApprovals = useMemo(() => {
    const list = approvals.filter((approval) => {
      if (profile?.role === "Employee" && approval.requesterUid !== profile.uid && approval.approverUid !== profile.uid && approval.assigneeUid !== profile.uid) {
        return false;
      }
      if (filters.module !== "all" && approval.module !== filters.module) return false;
      if (filters.department !== "all" && approval.departmentId !== filters.department) return false;
      if (filters.requester !== "all" && approval.requesterUid !== filters.requester) return false;
      if (filters.status !== "all" && approval.status !== filters.status) return false;
      if (filters.priority !== "all" && approval.priority !== filters.priority) return false;
      if (filters.sensitivity !== "all" && approval.sensitivity !== filters.sensitivity) return false;
      if (search && ![approval.title, approval.action, approval.reason ?? "", approval.requesterName ?? ""].join(" ").toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    });

    return list.filter((approval) => {
      if (tab === "Inbox") return ["Submitted", "Under Review", "Returned"].includes(approval.status);
      if (tab === "My Approvals") return approval.approverUid === profile?.uid || approval.assigneeUid === profile?.uid;
      if (tab === "Submitted") return approval.requesterUid === profile?.uid;
      if (tab === "Returned") return approval.status === "Returned";
      if (tab === "Approved") return approval.status === "Approved";
      if (tab === "Rejected") return approval.status === "Rejected";
      if (tab === "History") return ["Approved", "Rejected", "Cancelled", "Expired"].includes(approval.status);
      return true;
    });
  }, [approvals, filters, profile, search, tab]);

  const seedExamples = async () => {
    if (!profile || !profile.institutionId) return;
    setSeeding(true);
    try {
      const examples = seedApprovalExamples(profile.institutionId, profile);
      await Promise.all(examples.map((example) => saveApproval(example)));
    } finally {
      setSeeding(false);
    }
  };

  const handleStatusAction = async (approval: ApprovalRecord, nextStatus: ApprovalStatus) => {
    if (!profile || !profile.institutionId) return;
    const task = nextStatus === "Under Review"
      ? {
          title: `Approval review: ${approval.title}`,
          description: `${approval.action} requires review for ${approval.module}.`,
          departmentId: approval.departmentId ?? profile.departmentId ?? null,
          assignedTo: approval.assigneeUid ?? profile.uid,
          priority: approval.priority,
          dueInDays: 3,
        }
      : undefined;

    await updateApprovalStatus(approval.approvalId, nextStatus, profile.uid, {
      reason: `Reviewed by ${profile.fullName}`,
      comments: `Queued to ${nextStatus.toLowerCase()}.`,
      evidence: approval.evidence ?? [],
      approvalAuthority: profile.role,
      createTask: Boolean(task),
      task,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SectionHeading
          eyebrow="Control"
          title="Approvals"
          description="Configurable approval engine for cross-module operations and sensitive actions."
        />
        <div className="flex items-center gap-2">
          <Button onClick={() => void seedExamples()} disabled={!profile || seeding} className="bg-accent text-white">
            {seeding ? "Creating samples..." : "Create sample approvals"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <Button key={item} className={tab === item ? "bg-accent text-white" : ""} onClick={() => setTab(item)}>
            {item}
          </Button>
        ))}
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search approvals" />
          <select value={filters.module} onChange={(event) => setFilters((current) => ({ ...current, module: event.target.value }))} className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink">
            <option value="all">All modules</option>
            <option value="general">General</option>
            <option value="documents">Documents</option>
            <option value="finance">Finance</option>
            <option value="inventory">Inventory</option>
          </select>
          <select value={filters.department} onChange={(event) => setFilters((current) => ({ ...current, department: event.target.value }))} className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink">
            <option value="all">All departments</option>
            {departments.map((department) => (
              <option key={department.departmentId} value={department.departmentId}>{department.name}</option>
            ))}
          </select>
          <select value={filters.requester} onChange={(event) => setFilters((current) => ({ ...current, requester: event.target.value }))} className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink">
            <option value="all">All requesters</option>
            {employees.map((employee) => (
              <option key={employee.uid} value={employee.uid}>{employee.fullName}</option>
            ))}
          </select>
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink">
            <option value="all">All statuses</option>
            <option value="Draft">Draft</option>
            <option value="Submitted">Submitted</option>
            <option value="Under Review">Under Review</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Returned">Returned</option>
            <option value="Cancelled">Cancelled</option>
            <option value="Expired">Expired</option>
          </select>
          <select value={filters.priority} onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value }))} className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink">
            <option value="all">All priorities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <select value={filters.sensitivity} onChange={(event) => setFilters((current) => ({ ...current, sensitivity: event.target.value }))} className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink">
            <option value="all">All sensitivity</option>
            <option value="public">Public</option>
            <option value="internal">Internal</option>
            <option value="confidential">Confidential</option>
            <option value="restricted">Restricted</option>
          </select>
        </div>
      </Card>

      {!profile ? (
        <Card className="p-6 text-sm text-muted">Sign in to access the approval inbox.</Card>
      ) : loading ? (
        <Card className="p-6 text-sm text-muted">Loading approvals…</Card>
      ) : visibleApprovals.length === 0 ? (
        <Card className="p-6 text-sm text-muted">No approvals match the current view. Create a sample approval to test the workflow engine.</Card>
      ) : (
        <div className="space-y-4">
          {visibleApprovals.map((approval) => (
            <Card key={approval.approvalId} className="p-5">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge className={statusStyles[approval.status]}>{approval.status}</Badge>
                    <Badge className="border-line/80 bg-surface-raised text-muted">{approval.module}</Badge>
                    <Badge className="border-line/80 bg-surface-raised text-muted">{approval.priority}</Badge>
                    <Badge className="border-line/80 bg-surface-raised text-muted">{approval.sensitivity}</Badge>
                  </div>
                  <h3 className="text-lg font-semibold text-ink">{approval.title}</h3>
                  <p className="mt-2 text-sm text-muted">{approval.action}</p>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
                    <span>Requester: {approval.requesterName ?? employeeLookup.get(approval.requesterUid) ?? approval.requesterUid}</span>
                    <span>Department: {departmentLookup.get(approval.departmentId ?? "") ?? approval.departmentId ?? "Shared"}</span>
                    <span>Approver: {approval.approverUid ? employeeLookup.get(approval.approverUid) ?? approval.approverUid : "Not assigned"}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void handleStatusAction(approval, "Approved")} className="border-success/50 bg-success/10 text-success hover:bg-success/20">Approve</Button>
                  <Button onClick={() => void handleStatusAction(approval, "Rejected")} className="border-danger/50 bg-danger/10 text-danger hover:bg-danger/20">Reject</Button>
                  <Button onClick={() => void handleStatusAction(approval, "Returned")} className="border-warning/50 bg-warning/10 text-warning hover:bg-warning/20">Return</Button>
                  <Button onClick={() => void handleStatusAction(approval, "Under Review")} className="border-accent/50 bg-accent/10 text-accent hover:bg-accent/20">Review</Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <div className="rounded-md border border-line bg-surface-raised p-3">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Risk</div>
                  <div className="mt-2 text-sm font-medium text-ink">{approval.risk}</div>
                </div>
                <div className="rounded-md border border-line bg-surface-raised p-3">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Amount</div>
                  <div className="mt-2 text-sm font-medium text-ink">{typeof approval.amount === "number" ? `$${approval.amount.toLocaleString()}` : "—"}</div>
                </div>
                <div className="rounded-md border border-line bg-surface-raised p-3">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Authority</div>
                  <div className="mt-2 text-sm font-medium text-ink">{approval.approvalAuthority ?? "Policy driven"}</div>
                </div>
              </div>

              <div className="mt-4 rounded-md border border-line bg-surface-raised p-3 text-sm text-muted">
                <div className="font-medium text-ink">Audit trail</div>
                <div className="mt-2 space-y-2">
                  {(approval.auditTrail ?? []).slice(-3).map((entry) => (
                    <div key={entry.eventId} className="flex flex-col gap-1 border-t border-line/60 pt-2 first:border-t-0 first:pt-0">
                      <span>{entry.action} by {entry.actorUid}</span>
                      <span>{entry.previousStatus} → {entry.newStatus}</span>
                      {entry.reason && <span>{entry.reason}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
