"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState, PageHeader, SummaryMetrics } from "@/components/shared/page-shell";
import { useAuth } from "@/lib/auth-context";
import type { SecurityIncidentSeverity, SecurityIncidentStatus, SecurityPostureCheck } from "@/lib/security-center/engine";

type Incident = {
  incidentId: string;
  title: string;
  summary: string;
  severity: SecurityIncidentSeverity;
  status: SecurityIncidentStatus;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type SecurityCenterResponse = {
  observedAt: string;
  sampleLimit: number;
  capabilities: { manageIncidents: boolean; containIncidents: boolean };
  postureChecks: SecurityPostureCheck[];
  incidents: Incident[];
  nextCursor: string | null;
};

function errorMessage(status: number, message: string) {
  if (status === 401) return "Your session has expired. Sign in again to continue.";
  if (status === 403) return "Your effective permissions do not allow this Security Center action.";
  if (status === 409) return "The incident changed or the request conflicted. Refresh the list before retrying.";
  return message || "The Security Center request could not be completed.";
}

function statusStyle(status: SecurityPostureCheck["status"]) {
  if (status === "Needs Attention") return "border-warning/30 bg-warning/5 text-warning";
  if (status === "At Risk") return "border-danger/30 bg-danger/5 text-danger";
  if (status === "Not Enough Data") return "border-line bg-surface-raised text-muted";
  return "border-accent/30 bg-accent-soft text-accent";
}

function nextStatuses(status: SecurityIncidentStatus): SecurityIncidentStatus[] {
  if (status === "draft") return ["OPEN"];
  if (status === "OPEN") return ["TRIAGED"];
  if (status === "RESOLVED" || status === "CLOSED") return ["TRIAGED"];
  if (status === "CONTAINING") return ["RESOLVED"];
  return [];
}

export default function SecurityCenterPage() {
  const { profile, loading } = useAuth();
  const [data, setData] = useState<SecurityCenterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [severity, setSeverity] = useState<SecurityIncidentSeverity>("moderate");
  const [reason, setReason] = useState("");
  const [targetUid, setTargetUid] = useState("");
  const [confirmContainment, setConfirmContainment] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);

  const load = useCallback(async (nextCursor: string | null = null) => {
    setError(null);
    try {
      const query = nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : "";
      const response = await fetch(`/api/security-center${query}`);
      const body = await response.json() as SecurityCenterResponse & { error?: string };
      if (!response.ok) throw new Error(errorMessage(response.status, body.error ?? ""));
      setData(body);
      setCursor(nextCursor);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The Security Center could not be loaded.");
    }
  }, []);

  useEffect(() => {
    if (!loading && profile) void load();
  }, [load, loading, profile]);

  const submit = useCallback(async (payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/security-center", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey: crypto.randomUUID() }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(errorMessage(response.status, body.error ?? ""));
      setNotice(success);
      setReason("");
      setTargetUid("");
      setConfirmContainment(false);
      await load(cursor);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The Security Center action failed.");
    } finally {
      setBusy(false);
    }
  }, [cursor, load]);

  if (loading) return <LoadingState label="Verifying Security Center access…" />;
  if (!profile) return <EmptyState title="Sign in to view security posture" description="Security posture is restricted to authorized institution members." />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <LoadingState label="Loading bounded security posture samples…" />;

  const attentionCount = data.postureChecks.filter((check) => check.status === "Needs Attention" || check.status === "At Risk").length;
  const incompleteCount = data.postureChecks.filter((check) => check.status === "Not Enough Data").length;

  return (
    <div>
      <PageHeader
        title="Security Center"
        description="Evidence-backed security posture and institution-scoped incident tracking. Unknown or incomplete evidence is never reported as healthy."
        primaryAction={<Button type="button" onClick={() => void load(cursor)} disabled={busy}><RefreshCw size={16} />Refresh</Button>}
        secondaryActions={<span className="text-xs text-muted">Observed {new Date(data.observedAt).toLocaleString()}</span>}
      />
      {notice ? <p className="mb-4 rounded-md border border-line bg-surface-raised p-3 text-sm text-ink" role="status">{notice}</p> : null}
      {error ? <ErrorState message={error} onRetry={() => void load(cursor)} /> : null}
      <SummaryMetrics items={[
        { label: "Posture checks", value: data.postureChecks.length, hint: `Up to ${data.sampleLimit} records per source` },
        { label: "Attention", value: attentionCount, hint: "Observed in bounded samples" },
        { label: "Incomplete / unavailable", value: incompleteCount },
        { label: "Open incidents", value: data.incidents.filter((incident) => !["RESOLVED", "CLOSED"].includes(incident.status)).length },
      ]} />
      <Card className="mb-6 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink"><AlertTriangle size={16} className="text-warning" />Evidence limitations</p>
        <p className="mt-2 text-sm text-muted">
          Posture reads are bounded samples, not a full-tenant census. Review the source and status on every check; policy thresholds and missing collectors are called out instead of inferred.
        </p>
      </Card>

      <section aria-labelledby="security-posture-title">
        <h2 id="security-posture-title" className="mb-3 text-lg font-semibold text-ink">Security posture checks</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {data.postureChecks.map((check) => (
            <Card key={check.checkId} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-semibold text-ink">{check.title}</h3>
                <span className={`rounded border px-2 py-1 text-xs font-medium uppercase ${statusStyle(check.status)}`}>{check.status.replace("_", " ")}</span>
              </div>
              <p className="mt-3 text-sm text-ink">{check.evaluation}</p>
              <p className="mt-2 text-sm text-muted">{check.evidence}</p>
              <dl className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
                <div><dt className="font-semibold text-ink">Data source</dt><dd>{check.source}</dd></div>
                <div><dt className="font-semibold text-ink">Freshness</dt><dd>{check.freshnessRequirement}</dd></div>
                <div><dt className="font-semibold text-ink">Permission</dt><dd>{check.permission}</dd></div>
                <div><dt className="font-semibold text-ink">Remediation</dt><dd>{check.remediation}</dd></div>
              </dl>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="security-incidents-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="security-incidents-title" className="text-lg font-semibold text-ink">Security incidents</h2>
            <p className="text-sm text-muted">Draft incidents require an explicit review before they are opened. Acknowledgement does not resolve an incident.</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" disabled={busy || cursorHistory.length === 0} onClick={() => {
              const previous = [...cursorHistory];
              const target = previous.pop() ?? null;
              setCursorHistory(previous);
              void load(target);
            }}>Previous</Button>
            <Button type="button" disabled={busy || !data.nextCursor} onClick={() => {
              setCursorHistory((history) => [...history, cursor]);
              void load(data.nextCursor);
            }}>Next</Button>
          </div>
        </div>
        {data.capabilities.manageIncidents ? (
          <Card className="mb-4 p-4">
            <h3 className="font-semibold text-ink">Create an incident draft</h3>
            <p className="mt-1 text-xs text-muted">Do not include health, credentials, or unnecessary personal information in the summary.</p>
            <form className="mt-3 grid gap-3" onSubmit={(event) => {
              event.preventDefault();
              void submit({ action: "create_draft", title, summary, severity }, "Incident draft created.");
            }}>
              <label className="grid gap-1 text-sm text-ink">Title
                <input className="h-10 rounded-md border border-line bg-surface px-3" required maxLength={140} value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm text-ink">Summary
                <textarea className="min-h-24 rounded-md border border-line bg-surface px-3 py-2" required minLength={8} maxLength={2000} value={summary} onChange={(event) => setSummary(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm text-ink">Severity
                <select className="h-10 rounded-md border border-line bg-surface px-3" value={severity} onChange={(event) => setSeverity(event.target.value as SecurityIncidentSeverity)}>
                  <option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option><option value="critical">Critical</option>
                </select>
              </label>
              <div><Button type="submit" disabled={busy}><ShieldCheck size={16} />Create draft</Button></div>
            </form>
          </Card>
        ) : null}

        {data.incidents.length === 0 ? (
          <EmptyState
            title="No incident records on this page"
            description={data.capabilities.manageIncidents ? "Create a draft when there is a specific security event to review." : "No incidents were returned for this institution."}
          />
        ) : (
          <div className="space-y-3">
            {data.incidents.map((incident) => (
              <Card key={incident.incidentId} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-ink">{incident.title}</h3>
                    <p className="mt-1 text-sm text-muted">{incident.summary}</p>
                  </div>
                  <span className="rounded border border-line bg-surface-raised px-2 py-1 text-xs uppercase text-ink">{incident.severity} · {incident.status}</span>
                </div>
                <p className="mt-2 text-xs text-muted">Updated {incident.updatedAt ?? "time unavailable"} · Version {incident.version}</p>
                {data.capabilities.manageIncidents && incident.status !== "CLOSED" ? (
                  <div className="mt-4 grid gap-3 border-t border-line pt-3">
                    <label className="grid gap-1 text-sm text-ink">Reason for the next action
                      <input className="h-10 rounded-md border border-line bg-surface px-3" minLength={8} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {nextStatuses(incident.status).map((nextStatus) => (
                        <Button key={nextStatus} type="button" disabled={busy || reason.trim().length < 8} onClick={() => void submit({
                          action: "transition",
                          incidentId: incident.incidentId,
                          expectedVersion: incident.version,
                          nextStatus,
                          reason,
                        }, `Incident moved to ${nextStatus}.`)}>
                          {incident.status === "RESOLVED" || incident.status === "CLOSED" ? "Reopen incident" : `Move to ${nextStatus}`}
                        </Button>
                      ))}
                      {incident.status === "TRIAGED" && data.capabilities.containIncidents ? (
                        <div className="grid basis-full gap-2 rounded-md border border-warning/30 p-3">
                          <label className="grid gap-1 text-sm text-ink">Target member UID
                            <input className="h-10 rounded-md border border-line bg-surface px-3" value={targetUid} onChange={(event) => setTargetUid(event.target.value)} />
                          </label>
                          <label className="flex items-start gap-2 text-sm text-ink">
                            <input type="checkbox" checked={confirmContainment} onChange={(event) => setConfirmContainment(event.target.checked)} />
                            Revoke the target member&apos;s sessions and refresh tokens, and record this containment action.
                          </label>
                          <div><Button type="button" disabled={busy || !targetUid.trim() || !confirmContainment || reason.trim().length < 8} onClick={() => void submit({
                            action: "contain_sessions",
                            incidentId: incident.incidentId,
                            expectedVersion: incident.version,
                            targetUid,
                            reason,
                          }, "Session revocation completed and the incident was updated where its version remained current.")}>Contain by revoking sessions</Button></div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </section>
      <p className="mt-6 text-xs text-muted">Performance budget: one incident page query (20 records) and up to ten institution-scoped source samples capped at {data.sampleLimit} records each; MFA uses one batched Auth lookup for that sample.</p>
    </div>
  );
}
