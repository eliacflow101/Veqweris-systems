"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState, PageHeader, SummaryMetrics } from "@/components/shared/page-shell";
import { AuditTab, InstitutionsTab, OperatorsTab, PlansTab, SupportTab } from "@/components/platform/console";
import { usePlatformOperator } from "@/lib/platform/client";
import { platformApi, type PlatformAuditEvent, type PlatformDashboardResponse, type PlatformInstitutionResponse, type PlatformOperator } from "@/lib/platform/api-client";

type Tab = "institutions" | "plans" | "support" | "operators" | "audit";

const tabs: Array<{ id: Tab; label: string; capability?: "operators.manage" | "audit.view" }> = [
  { id: "institutions", label: "Institutions" },
  { id: "plans", label: "Plans & relationships" },
  { id: "support", label: "Support access" },
  { id: "operators", label: "Operators", capability: "operators.manage" },
  { id: "audit", label: "Platform audit", capability: "audit.view" },
];

export default function PlatformAdminPage() {
  const { operator, loading, isPlatformOperator, can, reload } = usePlatformOperator();
  const [tab, setTab] = useState<Tab>("institutions");
  const [dashboard, setDashboard] = useState<PlatformDashboardResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlatformInstitutionResponse | null>(null);
  const [operators, setOperators] = useState<PlatformOperator[]>([]);
  const [auditEvents, setAuditEvents] = useState<PlatformAuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);

  const loadDashboard = useCallback(async (nextCursor: string | null = null) => {
    setError(null);
    try {
      setDashboard(await platformApi.dashboard(nextCursor));
      setCursor(nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load the platform console.");
    }
  }, []);

  const loadDetail = useCallback(async (institutionId: string) => {
    setError(null);
    try {
      setDetail(await platformApi.institution(institutionId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load the institution.");
    }
  }, []);

  useEffect(() => {
    if (loading || !isPlatformOperator) return;
    void loadDashboard();
  }, [isPlatformOperator, loadDashboard, loading]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  useEffect(() => {
    if (tab !== "operators" || !can("operators.manage")) return;
    platformApi.operators()
      .then((result) => setOperators(result.operators))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load operators."));
  }, [can, tab]);

  useEffect(() => {
    if (tab !== "audit" || !can("audit.view")) return;
    platformApi.audit()
      .then((result) => setAuditEvents(result.events ?? []))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load the audit trail."));
  }, [can, tab]);

  const runAction = useCallback(async (body: Record<string, unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await platformApi.action(body);
      setNotice(successMessage);
      await loadDashboard(cursor);
      if (selectedId) await loadDetail(selectedId);
      if (body.action === "register_operator" || body.action === "set_operator_status") {
        setOperators((await platformApi.operators()).operators);
      }
      if (body.action === "grant_support" || body.action === "revoke_support") {
        setAuditEvents((await platformApi.audit()).events ?? []);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The platform action failed.");
    } finally {
      setBusy(false);
    }
  }, [cursor, loadDashboard, loadDetail, selectedId]);

  if (loading) return <LoadingState label="Verifying platform operator authorization…" />;
  if (!isPlatformOperator) {
    return (
      <EmptyState
        title="Platform operator access required"
        description="This console is restricted to VEQWERIS platform operators. Institution roles — including Owner and Admin — never grant platform administration access."
      />
    );
  }
  if (error && !dashboard) return <ErrorState message={error} onRetry={() => void loadDashboard()} />;
  if (!dashboard) return <LoadingState label="Loading platform console…" />;

  const stats = dashboard.statistics;
  return (
    <div>
      <PageHeader
        title="Platform Administration Console"
        description="Operator-only console for institution lifecycle, relationships, subscription plans, entitlements, monitoring and support access. No tenant operational records are exposed here."
        primaryAction={<Button type="button" onClick={() => void reload()}>Refresh authorization</Button>}
        secondaryActions={<Badge>{operator?.platformRole}</Badge>}
      />

      {notice && <p className="mb-4 rounded-md border border-line bg-surface-raised p-3 text-sm text-ink">{notice}</p>}
      {error && <p className="mb-4 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p>}

      <SummaryMetrics items={[
        { label: "Institutions on this page", value: dashboard.directory.pageCount },
        { label: "Suspended", value: stats.suspended },
        { label: "Billing enabled", value: stats.billingEnabled },
        { label: "Billing exempt", value: stats.billingExempt, hint: "Internal / Partner" },
      ]} />
      {tab === "institutions" && (
        <div className="mb-4 flex items-center justify-between text-sm text-muted">
          <span>Directory page size: {dashboard.directory.pageSize}</span>
          <div className="flex gap-2">
            <Button type="button" disabled={busy || cursorHistory.length === 0} onClick={() => {
              const previous = [...cursorHistory];
              const target = previous.pop() ?? null;
              setCursorHistory(previous);
              void loadDashboard(target);
            }}>Previous</Button>
            <Button type="button" disabled={busy || !dashboard.directory.nextCursor} onClick={() => {
              setCursorHistory((history) => [...history, cursor]);
              void loadDashboard(dashboard.directory.nextCursor);
            }}>Next</Button>
          </div>
        </div>
      )}

      <nav className="mb-5 flex flex-wrap gap-2">
        {tabs.filter((entry) => (!entry.capability || can(entry.capability))
          && !(entry.id === "audit" && operator?.platformRole === "Platform Support")).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`h-9 rounded-md border px-3 text-sm ${tab === entry.id ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-muted hover:text-ink"}`}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === "institutions" && (
        <InstitutionsTab
          dashboard={dashboard}
          detail={detail}
          selectedId={selectedId}
          busy={busy}
          canManage={can("institutions.manage")}
          canAssignPlan={can("plans.assign")}
          canAssignRelationship={can("relationships.assign")}
          canManageFeatures={can("features.manage")}
          canManageBilling={can("billing.manage")}
          canGrantSupport={can("support.grant")}
          onSelect={setSelectedId}
          onAction={runAction}
        />
      )}
      {tab === "plans" && (
        <PlansTab
          dashboard={dashboard}
          busy={busy}
          canAssignPlan={can("plans.assign")}
          canAssignRelationship={can("relationships.assign")}
          canManageBilling={can("billing.manage")}
          canManageFeatures={can("features.manage")}
          canManageCatalog={can("plans.manage")}
          onAction={runAction}
        />
      )}
      {tab === "support" && (
        <SupportTab dashboard={dashboard} busy={busy} canGrantSupport={can("support.grant")} onAction={runAction} />
      )}
      {tab === "operators" && <OperatorsTab operators={operators} busy={busy} onAction={runAction} />}
      {tab === "audit" && <AuditTab events={auditEvents} />}
    </div>
  );
}