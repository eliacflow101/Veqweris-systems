"use client";

import { useEffect, useState } from "react";
import { BarChart3, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/shared/page-shell";
import { useAuth } from "@/lib/auth-context";
import type { MetricDefinition, MetricSnapshot } from "@/lib/analytics";

type AnalyticsResponse = { metrics: MetricDefinition[]; snapshots: MetricSnapshot[]; state: "ready" | "no_data"; noDataReason?: string };

export default function AnalyticsPage() {
  const { profile, loading: authLoading } = useAuth();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  useEffect(() => {
    if (!profile) return;
    let active = true;
    const query = new URLSearchParams();
    if (domain) query.set("domain", domain);
    if (periodStart) query.set("periodStart", periodStart);
    if (periodEnd) query.set("periodEnd", periodEnd);
    fetch(`/api/analytics${query.size ? `?${query.toString()}` : ""}`).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error ?? "Unable to load analytics.");
      return response.json() as Promise<AnalyticsResponse>;
    }).then((result) => { if (active) setData(result); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Unable to load analytics."); });
    return () => { active = false; };
  }, [profile, domain, periodStart, periodEnd]);

  if (authLoading) return <LoadingState label="Loading analytics workspace…" />;
  if (!profile) return <EmptyState title="Sign in to view analytics" description="Analytics are isolated to your authenticated institution workspace." />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading metric registry and snapshots…" />;

  return (
    <div>
      <PageHeader title="Analytics" description="Traceable institution metrics with explicit freshness, sensitivity, and source lineage." />
      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted">Domain<select value={domain} onChange={(event) => setDomain(event.target.value)} className="mt-1 block h-9 rounded border border-line bg-surface-raised px-2 text-sm text-ink"><option value="">All domains</option><option value="workforce">Workforce</option><option value="operations">Operations</option><option value="finance">Finance</option><option value="education">Education</option><option value="healthcare">Healthcare</option><option value="governance">Governance</option></select></label>
          <label className="text-xs text-muted">From<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className="mt-1 block h-9 rounded border border-line bg-surface-raised px-2 text-sm text-ink" /></label>
          <label className="text-xs text-muted">To<input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} className="mt-1 block h-9 rounded border border-line bg-surface-raised px-2 text-sm text-ink" /></label>
          <button type="button" onClick={() => { setDomain(""); setPeriodStart(""); setPeriodEnd(""); }} className="h-9 rounded border border-line px-3 text-xs text-muted hover:text-ink">Reset</button>
          <span className="ml-auto text-xs text-muted">Exports are permission-checked and audited.</span>
        </div>
      </Card>
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <Card className="p-4"><BarChart3 className="text-accent" size={18} /><p className="mt-3 text-xs uppercase tracking-[0.12em] text-muted">Registered metrics</p><p className="mt-1 text-2xl font-semibold text-ink">{data.metrics.length}</p></Card>
        <Card className="p-4"><ShieldCheck className="text-accent" size={18} /><p className="mt-3 text-xs uppercase tracking-[0.12em] text-muted">Scope</p><p className="mt-1 text-2xl font-semibold text-ink">Institution</p></Card>
        <Card className="p-4"><p className="text-xs uppercase tracking-[0.12em] text-muted">Snapshots</p><p className="mt-3 text-2xl font-semibold text-ink">{data.snapshots.length}</p><p className="mt-1 text-xs text-muted">Server-published evidence</p></Card>
      </div>
      {data.state === "no_data" ? <EmptyState title="No analytics data yet" description={data.noDataReason ?? "No snapshots match this institution. Metrics will appear after a governed snapshot is published."} /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.snapshots.map((snapshot) => {
            const metric = data.metrics.find((item) => item.metricId === snapshot.metricId);
            return <Card key={snapshot.snapshotId} className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.12em] text-muted">{metric?.domain}</p><h2 className="mt-1 text-lg font-semibold text-ink">{metric?.name ?? snapshot.metricId}</h2></div><span className="rounded-full bg-accent-soft px-2 py-1 text-xs text-accent">{metric?.sensitivity}</span></div><p className="mt-5 text-3xl font-semibold text-ink">{snapshot.value ?? "—"}</p><p className="mt-2 text-xs text-muted">{snapshot.periodStart} to {snapshot.periodEnd} · Source: {snapshot.lineage.sourceCollection}</p></Card>;
          })}
        </div>
      )}
    </div>
  );
}
