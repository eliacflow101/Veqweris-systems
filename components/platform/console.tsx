"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/page-shell";
import type {
  PlatformAuditEvent, PlatformDashboardResponse, PlatformInstitutionResponse, PlatformInstitutionView,
  PlatformOperator, PlatformRole, PlanFeature, SubscriptionPlan, SupportScope,
} from "@/lib/platform/api-client";

export type PlatformAction = (body: Record<string, unknown>, successMessage: string) => Promise<void>;

export type PlatformModuleEntry = { moduleId: string; label: string; section: string };

const relationshipTone = (relationship: string) => relationship === "Customer" ? "bg-surface-raised text-muted" : "bg-accent-soft text-accent";
const healthTone = (level: string) => level === "critical" ? "bg-danger/10 text-danger" : level === "attention" ? "bg-warning/10 text-warning" : level === "unknown" ? "bg-surface-raised text-muted" : "bg-success/10 text-success";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

const trustStates = ["Registered", "Verified", "Trusted Network Member", "Enterprise Partner", "Restricted", "Suspended", "Revoked"] as const;
const supportScopeOptions: SupportScope[] = ["institution.overview", "usage.view", "billing.view", "security.view", "audit.view"];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-sm text-muted"><span>{label}</span>{children}</label>;
}

function Select({ value, onChange, children, disabled = false }: { value: string; onChange: (value: string) => void; children: ReactNode; disabled?: boolean }) {
  return <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink disabled:opacity-50">{children}</select>;
}

function InstitutionDetail({
  view, withheldScopes, supportAccess, modules, features, supportOperators, busy, canManage, canAssignPlan,
  canAssignRelationship, canManageFeatures, canManageBilling, canGrantSupport, onAction,
}: {
  view: PlatformInstitutionView;
  withheldScopes: SupportScope[];
  supportAccess?: PlatformInstitutionResponse["supportAccess"];
  modules: PlatformDashboardResponse["platformModules"];
  features: PlanFeature[];
  supportOperators: PlatformDashboardResponse["supportOperators"];
  busy: boolean;
  canManage: boolean;
  canAssignPlan: boolean;
  canAssignRelationship: boolean;
  canManageFeatures: boolean;
  canManageBilling: boolean;
  canGrantSupport: boolean;
  onAction: PlatformAction;
}) {
  const [planId, setPlanId] = useState<string>(view.plan.planId);
  const [relationship, setRelationship] = useState(view.relationship);
  const [trustState, setTrustState] = useState(view.networkTrustState ?? "Registered");
  const [selectedModules, setSelectedModules] = useState(view.entitlement.modules);
  const [selectedFeatures, setSelectedFeatures] = useState<PlanFeature[]>(view.entitlement.features);
  const [reason, setReason] = useState("");
  useEffect(() => {
    setPlanId(view.plan.planId);
    setRelationship(view.relationship);
    setTrustState(view.networkTrustState ?? "Registered");
    setSelectedModules(view.entitlement.modules);
    setSelectedFeatures(view.entitlement.features);
  }, [view]);
  return (
    <div className="grid gap-5">
      <Section title={`${view.name} — administration`} description={`Institution ${view.institutionId}. Platform support grants are read-only and scope-limited.`}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-md border border-line p-3"><p className="text-xs uppercase text-muted">Lifecycle</p><p className="mt-1 font-medium text-ink">{view.status}</p></div>
          <div className="rounded-md border border-line p-3"><p className="text-xs uppercase text-muted">Subscription</p><p className="mt-1 font-medium text-ink">{view.plan.name} · {view.subscription.status}</p></div>
          <div className="rounded-md border border-line p-3"><p className="text-xs uppercase text-muted">Security</p><p className="mt-1 font-medium text-ink">{view.securityState.level} · {view.securityState.reason}</p></div>
          <div className="rounded-md border border-line p-3"><p className="text-xs uppercase text-muted">Readiness</p><p className="mt-1 font-medium text-ink">{view.health.level}: {view.health.reasons.join(" ")}</p></div>
          <div className="rounded-md border border-line p-3"><p className="text-xs uppercase text-muted">Usage</p><p className="mt-1 font-medium text-ink">{view.usage ? `${view.usage.users ?? "Unavailable"} users · ${view.usage.departments ?? "Unavailable"} departments · ${view.usage.tasks ?? "Unavailable"} tasks` : "Not available in this scope"}</p></div>
          <div className="rounded-md border border-line p-3"><p className="text-xs uppercase text-muted">Support access</p><p className="mt-1 font-medium text-ink">{supportAccess ? `Read-only until ${new Date(supportAccess.expiresAt).toLocaleString()}` : "No active scoped support grant"}</p>{withheldScopes.length > 0 && <p className="mt-1 text-xs text-muted">Withheld: {withheldScopes.join(", ")}</p>}</div>
        </div>
      </Section>
      <Section title="Platform-controlled attributes" description="Changes are authorized by platform capability and written to platform and institution audit trails.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Subscription plan"><Select value={planId} onChange={(value) => setPlanId(value as typeof planId)} disabled={!canAssignPlan || busy}>{[...new Set([view.plan.planId, "basic", "professional", "enterprise", "internal", "developer", "partner"])].map((value) => <option key={value} value={value}>{value}</option>)}</Select><Button type="button" disabled={!canAssignPlan || busy || planId === view.plan.planId} onClick={() => void onAction({ action: "assign_plan", institutionId: view.institutionId, planId }, "Subscription plan updated.")}>Assign plan</Button></Field>
          <Field label="Relationship"><Select value={relationship} onChange={(value) => setRelationship(value as typeof relationship)} disabled={!canAssignRelationship || busy}>{["Internal", "Strategic Partner", "Customer", "Educational Partner", "Reseller", "Demonstration Institution"].map((value) => <option key={value}>{value}</option>)}</Select><Button type="button" disabled={!canAssignRelationship || busy || relationship === view.relationship} onClick={() => void onAction({ action: "assign_relationship", institutionId: view.institutionId, relationship }, "Institution relationship updated.")}>Assign relationship</Button></Field>
          <Field label="Institutional network trust"><Select value={trustState} onChange={(value) => setTrustState(value as typeof trustState)} disabled={!canManage || busy}>{trustStates.map((value) => <option key={value}>{value}</option>)}</Select><Button type="button" disabled={!canManage || busy || trustState === view.networkTrustState} onClick={() => void onAction({ action: "update_network_trust", institutionId: view.institutionId, trustState }, "Institution network trust state updated.")}>Update trust state</Button></Field>
          <Field label="Reason for security change"><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required for security changes" disabled={!canManage || busy} /><Button type="button" disabled={!canManage || busy || !reason.trim()} onClick={() => void onAction({ action: "update_security", institutionId: view.institutionId, level: view.securityState.level === "restricted" ? "standard" : "restricted", reason }, "Institution security state updated.")}>Toggle restricted security</Button></Field>
          <div className="flex flex-wrap items-end gap-2">
            <Button type="button" disabled={!canManage || busy} onClick={() => void onAction({ action: "update_status", institutionId: view.institutionId, status: view.status === "active" ? "suspended" : "active" }, view.status === "active" ? "Institution suspended." : "Institution reactivated.")}>{view.status === "active" ? "Suspend institution" : "Reactivate institution"}</Button>
            {canManageBilling && <Button type="button" disabled={busy} onClick={() => void onAction({ action: "update_billing", institutionId: view.institutionId, billingEnabled: !view.subscription.billingEnabled }, "Billing settings updated.")}>{view.subscription.billingEnabled ? "Disable billing" : "Enable billing"}</Button>}
          </div>
        </div>
      </Section>
      <Section title="Entitlements" description="These effective modules and features are enforced by tenant APIs and Firestore rules; platform overrides only add to plan entitlements.">
        <p className="text-sm font-medium text-ink">Modules</p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">{modules.map((module) => <Toggle key={module.moduleId} label={`${module.label} (${module.moduleId})`} checked={selectedModules.includes(module.moduleId)} disabled={!canManageFeatures || busy || (view.entitlement.modules.includes(module.moduleId) && !view.entitlement.overrides.modules?.includes(module.moduleId))} onChange={(checked) => setSelectedModules((current) => checked ? [...current, module.moduleId] : current.filter((item) => item !== module.moduleId))} />)}</div>
        <p className="mt-4 text-sm font-medium text-ink">Features</p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">{features.map((feature) => <Toggle key={feature} label={feature} checked={selectedFeatures.includes(feature)} disabled={!canManageFeatures || busy || view.entitlement.features.includes(feature)} onChange={(checked) => setSelectedFeatures((current) => checked ? [...current, feature] : current.filter((item) => item !== feature))} />)}</div>
        <Button className="mt-4" type="button" disabled={!canManageFeatures || busy} onClick={() => void onAction({ action: "update_entitlements", institutionId: view.institutionId, modules: selectedModules, features: selectedFeatures }, "Entitlements updated.")}>Save entitlement overrides</Button>
      </Section>
      <Section title="Monitoring" description={`${view.monitoring.available} available observations · ${view.monitoring.unavailable} unavailable`}>
        <div className="grid gap-2 md:grid-cols-2">{view.monitoring.observations.map((observation) => <div key={observation.domain} className="rounded-md border border-line p-3"><p className="font-medium text-ink">{observation.domain}: {observation.availability === "available" ? `${observation.value ?? "—"} ${observation.unit ?? ""}` : "Unavailable"}</p><p className="mt-1 text-xs text-muted">{observation.reason}</p><p className="mt-1 text-[10px] uppercase text-muted">Source: {observation.source}</p></div>)}</div>
      </Section>
      {canGrantSupport && <Section title="Grant read-only support access" description="Requires an explicit reason, scopes and expiration. The institution receives a security event.">
        <SupportGrantForm institutionId={view.institutionId} scopes={supportScopeOptions} supportOperators={supportOperators} busy={busy} onAction={onAction} />
      </Section>}
    </div>
  );
}

function SupportGrantForm({ institutionId, scopes, supportOperators, busy, onAction }: { institutionId: string; scopes: SupportScope[]; supportOperators: PlatformDashboardResponse["supportOperators"]; busy: boolean; onAction: PlatformAction }) {
  const [selectedScopes, setSelectedScopes] = useState<SupportScope[]>(["institution.overview"]);
  const [supportOperatorUid, setSupportOperatorUid] = useState(supportOperators[0]?.uid ?? "");
  const [reason, setReason] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  return <div className="grid gap-3">
    <Field label="Platform Support operator"><Select value={supportOperatorUid} onChange={setSupportOperatorUid}>{supportOperators.map((operator) => <option key={operator.uid} value={operator.uid}>{operator.displayName || operator.email} ({operator.uid})</option>)}</Select></Field>
    <Field label="Reason"><Input value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
    <Field label="Duration in minutes"><Input type="number" min="1" max="480" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} /></Field>
    <div className="flex flex-wrap gap-4">{scopes.map((scope) => <Toggle key={scope} label={scope} checked={selectedScopes.includes(scope)} onChange={(checked) => setSelectedScopes((current) => checked ? [...current, scope] : current.filter((item) => item !== scope))} />)}</div>
    <Button type="button" disabled={busy || !supportOperatorUid || !reason.trim() || selectedScopes.length === 0} onClick={() => void onAction({ action: "grant_support", institutionId, supportOperatorUid, reason, scopes: selectedScopes, durationMinutes: Number(durationMinutes) }, "Read-only support access granted.")}>Grant access</Button>
  </div>;
}

export function PlansTab({ dashboard, busy, canAssignPlan, canAssignRelationship, canManageBilling, canManageFeatures, canManageCatalog, onAction }: {
  dashboard: PlatformDashboardResponse; busy: boolean; canAssignPlan: boolean; canAssignRelationship: boolean;
  canManageBilling: boolean; canManageFeatures: boolean; canManageCatalog: boolean; onAction: PlatformAction;
}) {
  const [institutionId, setInstitutionId] = useState(dashboard.institutions[0]?.institutionId ?? "");
  const [planId, setPlanId] = useState<string>("basic");
  const [relationship, setRelationship] = useState("Customer");
  const [editingPlanId, setEditingPlanId] = useState<string>(dashboard.plans[0]?.planId ?? "");
  const [draft, setDraft] = useState<SubscriptionPlan | null>(dashboard.plans[0] ?? null);
  const selectedPlan = dashboard.plans.find((plan) => plan.planId === editingPlanId);
  const setPlanDraft = (patch: Partial<SubscriptionPlan>) => {
    if (draft) setDraft({ ...draft, ...patch });
  };
  return <Section title="Plans and relationships" description="Plan assignment and institutional relationship are separate platform-managed controls.">
    <div className="grid gap-3 md:grid-cols-3">
      <Field label="Institution"><Select value={institutionId} onChange={setInstitutionId}>{dashboard.institutions.map((item) => <option key={item.institutionId} value={item.institutionId}>{item.name}</option>)}</Select></Field>
      <Field label="Plan"><Select value={planId} onChange={setPlanId}>{dashboard.plans.filter((plan) => plan.status === "active").map((plan) => <option key={plan.planId} value={plan.planId}>{plan.name}</option>)}</Select></Field>
      <Field label="Relationship"><Select value={relationship} onChange={setRelationship}>{dashboard.relationships.map((item) => <option key={item} value={item}>{item}</option>)}</Select></Field>
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      <Button type="button" disabled={!institutionId || busy || !canAssignPlan} onClick={() => void onAction({ action: "assign_plan", institutionId, planId }, "Plan assigned.")}>Assign plan</Button>
      <Button type="button" disabled={!institutionId || busy || !canAssignRelationship} onClick={() => void onAction({ action: "assign_relationship", institutionId, relationship }, "Relationship assigned.")}>Assign relationship</Button>
      {!canManageBilling && <span className="text-xs text-muted">Billing changes require billing.manage.</span>}
      {!canManageFeatures && <span className="text-xs text-muted">Entitlement changes require features.manage.</span>}
    </div>
    {canManageCatalog && selectedPlan && draft && (
      <div className="mt-5 grid gap-3 rounded-md border border-line p-4 md:grid-cols-2">
        <Field label="Catalog plan"><Select value={editingPlanId} onChange={(id) => { setEditingPlanId(id); setDraft(dashboard.plans.find((plan) => plan.planId === id) ?? null); }}>{dashboard.plans.map((plan) => <option key={plan.planId} value={plan.planId}>{plan.name} ({plan.planId})</option>)}</Select></Field>
        <Field label="Plan name"><Input value={draft.name} onChange={(event) => setPlanDraft({ name: event.target.value })} /></Field>
        <Field label="Description"><Input value={draft.description} onChange={(event) => setPlanDraft({ description: event.target.value })} /></Field>
        <Field label="Status"><Select value={draft.status} onChange={(status) => setPlanDraft({ status: status as SubscriptionPlan["status"] })}><option value="active">Active</option><option value="deprecated">Deprecated</option></Select></Field>
        {Object.entries(draft.limits).map(([key, value]) => <Field key={key} label={`${key} (-1 = unlimited)`}><Input type="number" min={-1} step={1} value={value} onChange={(event) => setPlanDraft({ limits: { ...draft.limits, [key]: Number(event.target.value) } })} /></Field>)}
        <Field label="Module scope"><Select value={draft.moduleScope} onChange={(moduleScope) => setPlanDraft({ moduleScope: moduleScope as SubscriptionPlan["moduleScope"] })}><option value="core">Core</option><option value="extended">Extended</option><option value="all">All</option></Select></Field>
        <Field label="Billing"><Select value={String(draft.billingEnabled)} onChange={(value) => setPlanDraft({ billingEnabled: value === "true", invoicesEnabled: value === "true" && draft.invoicesEnabled })}><option value="true">Enabled</option><option value="false">Disabled</option></Select></Field>
        <Field label="Invoices"><Select value={String(draft.invoicesEnabled)} onChange={(value) => setPlanDraft({ invoicesEnabled: value === "true" })}><option value="true">Enabled</option><option value="false">Disabled</option></Select></Field>
        <Field label="Premium features"><Select value={String(draft.premiumFeatures)} onChange={(value) => setPlanDraft({ premiumFeatures: value === "true" })}><option value="true">Enabled</option><option value="false">Disabled</option></Select></Field>
        {draft.category === "commercial" && <Field label="Customer-visible"><Select value={String(draft.visibleToCustomers)} onChange={(value) => setPlanDraft({ visibleToCustomers: value === "true" })}><option value="true">Yes</option><option value="false">No</option></Select></Field>}
        <div className="grid gap-2 md:col-span-2">
          <p className="text-sm text-muted">Features</p>
          <div className="flex flex-wrap gap-4">{dashboard.featureKeys.map((feature) => {
            const selected = draft.features === "all" || draft.features.includes(feature);
            return <Toggle key={feature} label={feature} checked={selected} onChange={(checked) => {
              const current = draft.features === "all" ? [...dashboard.featureKeys] : draft.features;
              setPlanDraft({ features: checked ? [...new Set([...current, feature])] : current.filter((item) => item !== feature) });
            }} />;
          })}</div>
        </div>
        <div className="grid gap-2 md:col-span-2">
          <p className="text-sm text-muted">Allowed migration targets</p>
          <div className="flex flex-wrap gap-4">{dashboard.plans.filter((plan) => plan.planId !== draft.planId).map((plan) => <Toggle key={plan.planId} label={plan.planId} checked={draft.migrationTargets.includes(plan.planId)} onChange={(checked) => setPlanDraft({ migrationTargets: checked ? [...new Set([...draft.migrationTargets, plan.planId])] : draft.migrationTargets.filter((id) => id !== plan.planId) })} />)}</div>
        </div>
        <Button type="button" disabled={busy} onClick={() => void onAction({ action: "update_plan_catalog", plan: draft }, `Updated ${draft.name}.`)}>Save plan catalog changes</Button>
      </div>
    )}
    {!canManageCatalog && <p className="mt-4 text-sm text-muted">Plan catalog edits require plans.manage.</p>}
    <div className="mt-5 grid gap-2 sm:grid-cols-2">{dashboard.plans.map((plan) => <div key={plan.planId} className="rounded-md border border-line p-3"><p className="font-medium text-ink">{plan.name} · {plan.category} · {plan.status}</p><p className="mt-1 text-sm text-muted">{plan.description}</p><p className="mt-2 text-xs text-muted">Modules: {plan.moduleScope} · billing {plan.billingEnabled ? "enabled" : "disabled"} · invoices {plan.invoicesEnabled ? "enabled" : "disabled"}</p></div>)}</div>
  </Section>;
}

export function SupportTab({ dashboard, busy, canGrantSupport, onAction }: { dashboard: PlatformDashboardResponse; busy: boolean; canGrantSupport: boolean; onAction: PlatformAction }) {
  const [institutionId, setInstitutionId] = useState(dashboard.institutions[0]?.institutionId ?? "");
  const [supportOperatorUid, setSupportOperatorUid] = useState(dashboard.supportOperators[0]?.uid ?? "");
  const [reason, setReason] = useState("");
  const [grantId, setGrantId] = useState("");
  return <Section title="Support access" description="Support access is read-only, reasoned, scope-limited, automatically expiring and visible to the institution.">
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Institution"><Select value={institutionId} onChange={setInstitutionId}>{dashboard.institutions.map((item) => <option key={item.institutionId} value={item.institutionId}>{item.name} ({item.institutionId})</option>)}</Select></Field>
      <Field label="Platform Support operator"><Select value={supportOperatorUid} onChange={setSupportOperatorUid}>{dashboard.supportOperators.map((operator) => <option key={operator.uid} value={operator.uid}>{operator.displayName || operator.email} ({operator.uid})</option>)}</Select></Field>
      <Field label="Reason"><Input value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      <Field label="Grant ID to revoke"><Input value={grantId} onChange={(event) => setGrantId(event.target.value)} /></Field>
    </div>
    <div className="mt-3 flex gap-2">
      <Button type="button" disabled={!canGrantSupport || busy || !reason.trim() || !institutionId || !supportOperatorUid} onClick={() => void onAction({ action: "grant_support", institutionId, supportOperatorUid, scopes: ["institution.overview"], reason, durationMinutes: 60 }, "Read-only support access granted.")}>Grant overview access (60 min)</Button>
      <Button type="button" disabled={!canGrantSupport || busy || !grantId.trim()} onClick={() => void onAction({ action: "revoke_support", grantId, reason }, "Support access revoked.")}>Revoke grant</Button>
    </div>
    {!canGrantSupport && <p className="mt-3 text-sm text-muted">Your platform role cannot grant or revoke support access.</p>}
  </Section>;
}

export function OperatorsTab({ operators, busy, onAction }: { operators: PlatformOperator[]; busy: boolean; onAction: PlatformAction }) {
  const [uid, setUid] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PlatformRole>("Platform Analyst");
  const [reason, setReason] = useState("");
  return <div className="grid gap-5">
    <Section title="Register platform operator" description="This is a separate platform identity. Institution Owner/Admin roles do not grant access.">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Firebase Auth UID"><Input value={uid} onChange={(event) => setUid(event.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Platform role"><Select value={role} onChange={(value) => setRole(value as PlatformRole)}>{["Platform Owner", "Platform Administrator", "Platform Support", "Platform Analyst"].map((item) => <option key={item}>{item}</option>)}</Select></Field>
        <Field label="Grant reason"><Input value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      </div>
      <Button className="mt-3" type="button" disabled={busy || !uid.trim() || !email.trim()} onClick={() => void onAction({ action: "register_operator", uid, email, platformRole: role, reason }, "Platform operator registered.")}>Register operator</Button>
    </Section>
    <Section title="Current operators"><div className="grid gap-2">{operators.map((operator) => <div key={operator.uid} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3"><div><p className="font-medium text-ink">{operator.displayName || operator.email}</p><p className="text-xs text-muted">{operator.uid} · {operator.platformRole} · {operator.status}</p></div><div className="flex gap-2"><Button type="button" disabled={busy || operator.status === "active"} onClick={() => void onAction({ action: "set_operator_status", uid: operator.uid, status: "active" }, "Operator reactivated.")}>Reactivate</Button><Button type="button" disabled={busy || operator.status !== "active"} onClick={() => void onAction({ action: "set_operator_status", uid: operator.uid, status: "suspended" }, "Operator suspended.")}>Suspend</Button></div></div>)}</div></Section>
  </div>;
}

export function AuditTab({ events }: { events: PlatformAuditEvent[] }) {
  return <Section title="Platform audit trail" description="Latest platform administration events. Institution-targeted changes are also mirrored to tenant audit.">
    {events.length === 0 ? <EmptyState title="No platform audit events" description="Platform actions will appear here." /> : <div className="grid gap-2">{events.map((event) => <article key={event.eventId} className="rounded-md border border-line p-3"><div className="flex flex-wrap justify-between gap-2"><p className="font-medium text-ink">{event.action}</p><time className="text-xs text-muted">{new Date(event.occurredAt).toLocaleString()}</time></div><p className="mt-1 text-xs text-muted">Actor {event.actorUid} ({event.actorPlatformRole}) · target {event.targetInstitutionId ?? event.eventId}</p><pre className="mt-2 whitespace-pre-wrap break-all text-xs text-muted">{JSON.stringify(event.payload, null, 2)}</pre></article>)}</div>}
  </Section>;
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={`flex items-center gap-3 text-sm ${disabled ? "text-muted/60" : "text-ink"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[var(--accent,#4f46e5)]" />
      {label}
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Institutions                                                               */
/* -------------------------------------------------------------------------- */

export function InstitutionsTab({
  dashboard, detail, selectedId, busy, canManage, canAssignPlan, canAssignRelationship, canManageFeatures,
  canManageBilling, canGrantSupport, onSelect, onAction,
}: {
  dashboard: PlatformDashboardResponse;
  detail: PlatformInstitutionResponse | null;
  selectedId: string | null;
  busy: boolean;
  canManage: boolean;
  canAssignPlan: boolean;
  canAssignRelationship: boolean;
  canManageFeatures: boolean;
  canManageBilling: boolean;
  canGrantSupport: boolean;
  onSelect: (institutionId: string) => void;
  onAction: PlatformAction;
}) {
  return (
    <div className="grid gap-5">
      <Section title="Institution directory" description="Tenant-safe platform state only. Relationship and subscription plan are independent attributes.">
        {dashboard.institutions.length === 0 ? (
          <EmptyState title="No institutions are visible to this operator" description="Platform Support operators only see institutions covered by an explicit support grant." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.12em] text-muted">
                <tr>
                  <th className="pb-2">Institution</th>
                  <th className="pb-2">Relationship</th>
                  <th className="pb-2">Plan</th>
                  <th className="pb-2">Modules</th>
                  <th className="pb-2">Security</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {dashboard.institutions.map((institution) => (
                  <tr key={institution.institutionId}>
                    <td className="py-3">
                      <p className="font-medium text-ink">{institution.name}</p>
                      <p className="text-xs text-muted">{institution.country} · {institution.institutionId}</p>
                    </td>
                    <td className="py-3"><Badge className={relationshipTone(institution.relationship)}>{institution.relationship}</Badge></td>
                    <td className="py-3">
                      <p className="text-ink">{institution.planName}</p>
                      <p className="text-xs text-muted">{institution.planCategory} · billing {institution.billingEnabled ? "enabled" : "exempt"}</p>
                    </td>
                    <td className="py-3 text-muted">{institution.modules.length}</td>
                    <td className="py-3"><Badge className={healthTone(institution.securityLevel)}>{institution.securityLevel}</Badge></td>
                    <td className="py-3"><Badge className={institution.status === "active" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}>{institution.status}</Badge></td>
                    <td className="py-3 text-right">
                      <Button type="button" onClick={() => onSelect(institution.institutionId)}>
                        {selectedId === institution.institutionId ? "Reload" : "Inspect"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {detail?.view && (
        <InstitutionDetail
          key={detail.view.institutionId}
          view={detail.view}
          withheldScopes={detail.withheldScopes ?? []}
          supportAccess={detail.supportAccess}
          modules={dashboard.platformModules}
          features={dashboard.featureKeys}
          supportOperators={dashboard.supportOperators}
          busy={busy}
          canManage={canManage}
          canAssignPlan={canAssignPlan}
          canAssignRelationship={canAssignRelationship}
          canManageFeatures={canManageFeatures}
          canManageBilling={canManageBilling}
          canGrantSupport={canGrantSupport}
          onAction={onAction}
        />
      )}
    </div>
  );
}
