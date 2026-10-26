"use client";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/shared/section-heading";
import { useAuth } from "@/lib/auth-context";
import { isOnline, updateEmployee, useDepartments, useEmployees } from "@/lib/firebase/data";
import type { UserRole } from "@/lib/firebase/models";

type EmployeeImportPreviewRow = {
  rowId: string;
  fullName: string;
  officialEmail: string;
  institutionEmployeeId: string;
  department: string;
  role: string;
  allowed: boolean;
  issues: string[];
  duplicateState: string;
};

export default function EmployeesPage() {
  const { profile } = useAuth(); const { data } = useEmployees(profile?.institutionId); const { data: departments } = useDepartments(profile?.institutionId);
  const [role, setRole] = useState(""); const [department, setDepartment] = useState(""); const [search, setSearch] = useState(""); const [editing, setEditing] = useState<string | null>(null); const [inviteOpen, setInviteOpen] = useState(false); const [inviteName, setInviteName] = useState(""); const [inviteEmail, setInviteEmail] = useState(""); const [inviteRole, setInviteRole] = useState<UserRole>("Employee"); const [inviteDepartment, setInviteDepartment] = useState(""); const [inviteError, setInviteError] = useState<string | null>(null); const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null); const [inviting, setInviting] = useState(false);
  const [importOpen, setImportOpen] = useState(false); const [importFile, setImportFile] = useState<File | null>(null); const [importBatchId, setImportBatchId] = useState<string | null>(null); const [importPreview, setImportPreview] = useState<EmployeeImportPreviewRow[]>([]); const [importError, setImportError] = useState<string | null>(null); const [importMessage, setImportMessage] = useState<string | null>(null); const [importBusy, setImportBusy] = useState(false);
  const canEdit = profile?.role === "Owner" || profile?.role === "Admin"; const visible = data.filter((p) => (!role || p.role === role) && (!department || p.departmentId === department) && (!search || p.fullName.toLowerCase().includes(search.toLowerCase()) || p.email.toLowerCase().includes(search.toLowerCase())));
  const [employeeActionError, setEmployeeActionError] = useState<string | null>(null);
  async function inviteEmployee(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setInviting(true); setInviteError(null); setTemporaryPassword(null); try { const response = await fetch("/api/employees/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName: inviteName, email: inviteEmail, role: inviteRole, departmentId: inviteDepartment || null }) }); const result = await response.json() as { error?: string; temporaryPassword?: string }; if (!response.ok) throw new Error(result.error || "Unable to invite employee."); setTemporaryPassword(result.temporaryPassword ?? null); setInviteName(""); setInviteEmail(""); setInviteDepartment(""); } catch (reason) { setInviteError(reason instanceof Error ? reason.message : "Unable to invite employee."); } finally { setInviting(false); } }
  async function setEmployeeStatus(uid: string, status: "active" | "inactive") {
    setEmployeeActionError(null);
    try {
      const response = await fetch("/api/organization/memberships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid,
          status,
          reason: status === "active"
            ? "Employee reactivated from the Employees page."
            : "Employee deactivated from the Employees page.",
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to deactivate employee.");
      window.location.reload();
    } catch (reason) {
      setEmployeeActionError(reason instanceof Error ? reason.message : "Unable to deactivate employee.");
    }
  }
  async function previewImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importFile) { setImportError("Choose a CSV or XLSX file to preview."); return; }
    setImportBusy(true); setImportError(null); setImportMessage(null); setImportBatchId(null); setImportPreview([]);
    try {
      const form = new FormData();
      form.set("file", importFile);
      const response = await fetch("/api/employees/import", { method: "POST", body: form });
      const result = await response.json() as { error?: string; batchId?: string; preview?: EmployeeImportPreviewRow[] };
      if (!response.ok || !result.batchId || !result.preview) throw new Error(result.error || "Unable to prepare the import preview.");
      setImportBatchId(result.batchId);
      setImportPreview(result.preview);
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : "Unable to prepare the import preview.");
    } finally {
      setImportBusy(false);
    }
  }
  async function confirmImport() {
    if (!importBatchId) return;
    setImportBusy(true); setImportError(null); setImportMessage(null);
    try {
      const response = await fetch("/api/employees/import/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: importBatchId }),
      });
      const result = await response.json() as { error?: string; createdCount?: number; failedCount?: number; skippedCount?: number };
      if (!response.ok) throw new Error(result.error || "Unable to confirm the employee import.");
      setImportMessage(`Import complete: ${result.createdCount ?? 0} created, ${result.failedCount ?? 0} failed, ${result.skippedCount ?? 0} skipped.`);
      setImportBatchId(null);
      setImportPreview([]);
      setImportFile(null);
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : "Unable to confirm the employee import.");
    } finally {
      setImportBusy(false);
    }
  }
  async function cancelImport() {
    if (importBatchId) {
      setImportBusy(true); setImportError(null);
      try {
        const response = await fetch("/api/employees/import", {
          method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: importBatchId }),
        });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error || "Unable to cancel the import.");
      } catch (reason) {
        setImportError(reason instanceof Error ? reason.message : "Unable to cancel the import.");
        setImportBusy(false);
        return;
      }
      setImportBusy(false);
    }
    setImportBatchId(null); setImportPreview([]); setImportFile(null); setImportError(null);
  }
  return (
    <div>
      <SectionHeading eyebrow="Workspace" title="Employees" description="Find people across your institution and monitor their availability." />
      {canEdit && <div className="mb-5 flex justify-end gap-2">
        <Button className="bg-accent text-white" onClick={() => { setInviteOpen((value) => !value); setInviteError(null); setTemporaryPassword(null); }}>{inviteOpen ? "Close invite form" : "+ Invite Employee"}</Button>
        <Button onClick={() => { setImportOpen((value) => !value); setImportError(null); setImportMessage(null); }}>{importOpen ? "Close import" : "Import employees"}</Button>
      </div>}
      {canEdit && importOpen && <Card className="mb-5 p-5">
        <h2 className="font-semibold text-ink">Import employees from CSV or XLSX</h2>
        <p className="mt-1 text-sm text-muted">Upload a UTF-8 .csv file or a non-macro .xlsx workbook. Maximum file size is 5 MB, with up to 1,000 employee rows and 64 columns.</p>
        <p className="mt-1 text-sm text-muted">Excel workbooks must contain exactly one visible worksheet and no more than 64 archive entries or 16 MB expanded data. Formula cells, external links, macros, encrypted workbooks, and unsupported workbook features are rejected. Store employee numbers and phone numbers as text to preserve leading zeros.</p>
        {!importBatchId && <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center" onSubmit={previewImport}>
          <label className="sr-only" htmlFor="employee-import-file">Choose a CSV or XLSX employee file</label>
          <Input id="employee-import-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Choose a CSV or XLSX employee file" onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} />
          <Button type="submit" disabled={importBusy || !importFile} className="bg-accent text-white">{importBusy ? "Preparing preview..." : "Upload and preview"}</Button>
        </form>}
        {importPreview.length > 0 && <>
          <p className="mt-4 text-sm text-muted">{importPreview.filter((row) => row.allowed).length} expected to import; {importPreview.filter((row) => !row.allowed).length} rejected or needing review. Only valid rows are eligible for confirmation.</p>
          <div className="mt-3 max-h-72 overflow-auto rounded border border-line">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface"><tr><th className="p-2">Employee</th><th className="p-2">Email</th><th className="p-2">Department</th><th className="p-2">Status</th><th className="p-2">Issues</th></tr></thead>
              <tbody>{importPreview.slice(0, 100).map((row) => <tr className="border-t border-line" key={row.rowId}>
                <td className="p-2">{row.fullName || "—"}</td><td className="p-2">{row.officialEmail || "—"}</td><td className="p-2">{row.department || "—"}</td><td className="p-2">{row.allowed ? "Ready" : "Review"}</td><td className="p-2">{row.issues.join(", ") || row.duplicateState}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {importPreview.length > 100 && <p className="mt-2 text-xs text-muted">Showing first 100 of {importPreview.length} rows.</p>}
          <div className="mt-4 flex gap-2">
            <Button disabled={importBusy || !importPreview.some((row) => row.allowed)} className="bg-accent text-white" onClick={() => void confirmImport()}>{importBusy ? "Processing..." : "Confirm valid rows"}</Button>
            <Button disabled={importBusy} onClick={() => void cancelImport()}>Cancel import</Button>
          </div>
        </>}
        {importError && <p className="mt-3 text-sm text-danger" role="alert">{importError}</p>}
        {importMessage && <div className="mt-3 flex items-center gap-3 text-sm text-muted"><p>{importMessage}</p><Button onClick={() => window.location.reload()}>Refresh employee list</Button></div>}
      </Card>}
      {canEdit && inviteOpen && <Card className="mb-5 p-5">
        <form className="grid gap-3 md:grid-cols-2" onSubmit={inviteEmployee}>
          <Input required placeholder="Full name" value={inviteName} onChange={(event) => setInviteName(event.target.value)} />
          <Input required type="email" placeholder="Email address" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
          <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as UserRole)}><option>Employee</option><option>Manager</option><option>Admin</option></select>
          <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink" value={inviteDepartment} onChange={(event) => setInviteDepartment(event.target.value)}><option value="">No department</option>{departments.map((item) => <option key={item.departmentId} value={item.departmentId}>{item.name}</option>)}</select>
          <Button type="submit" disabled={inviting} className="bg-accent text-white md:col-span-2">{inviting ? "Inviting..." : "Send invite"}</Button>
        </form>
        {inviteError && <p className="mt-3 text-sm text-danger">{inviteError}</p>}
        {temporaryPassword && <p className="mt-3 text-sm text-muted">Account created. Share this temporary password securely with the invitee: <strong className="text-ink">{temporaryPassword}</strong></p>}
      </Card>}
      {employeeActionError && <p className="mb-4 text-sm text-danger" role="alert">{employeeActionError}</p>}
      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <Input placeholder="Search people" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink" value={role} onChange={(event) => setRole(event.target.value)}><option value="">All roles</option>{(["Owner", "Admin", "Manager", "Employee"] as UserRole[]).map((item) => <option key={item}>{item}</option>)}</select>
        <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink" value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">All departments</option>{departments.map((item) => <option key={item.departmentId} value={item.departmentId}>{item.name}</option>)}</select>
        <Badge className="h-9 items-center justify-center">{visible.length} people</Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((person) => <Card className="p-5" key={person.uid}>
          <div className="flex items-start justify-between"><div><p className="font-semibold text-ink">{person.fullName}</p><p className="mt-1 text-sm text-muted">{person.email}</p></div><span className={`mt-1 h-2.5 w-2.5 rounded-full ${isOnline(person.lastActive) ? "bg-success" : "bg-muted"}`} title={isOnline(person.lastActive) ? "Online" : "Offline"} /></div>
          <div className="mt-4 flex items-center justify-between"><Badge>{person.role}</Badge><span className="text-xs text-muted">{departments.find((item) => item.departmentId === person.departmentId)?.name ?? "Unassigned"}</span></div>
          {canEdit && editing === person.uid && <div className="mt-4 grid gap-2">
            <Input defaultValue={person.fullName} id={`name-${person.uid}`} />
            <p className="text-xs text-muted">System tier: {person.role}. System tiers are immutable; assign custom permissions through the organization access controls.</p>
            <Button className="bg-accent text-white" onClick={() => { const name = (document.getElementById(`name-${person.uid}`) as HTMLInputElement).value; void updateEmployee(person.uid, { fullName: name }).then(() => window.location.reload()); }}>Save</Button>
          </div>}
          {canEdit && editing !== person.uid && <div className="mt-4 flex gap-2"><Button onClick={() => setEditing(person.uid)}>Edit</Button><Button onClick={() => void setEmployeeStatus(person.uid, person.status === "active" ? "inactive" : "active")}>{person.status === "active" ? "Deactivate" : "Reactivate"}</Button></div>}
        </Card>)}
      </div>
      {!canEdit && <p className="mt-5 text-sm text-muted">Managers and employees have read-only access to this directory.</p>}
    </div>
  );
}
