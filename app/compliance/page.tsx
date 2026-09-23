"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/shared/page-shell";
import { useAuth } from "@/lib/auth-context";
import type { Finding, GovernanceStage } from "@/lib/governance";

type GovernanceResponse = { findings: Finding[]; chains: unknown[]; stages: GovernanceStage[] };

export default function CompliancePage() {
  const { profile, loading } = useAuth();
  const [data, setData] = useState<GovernanceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!profile) return;
    fetch("/api/governance").then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error ?? "Unable to load governance.");
      return response.json() as Promise<GovernanceResponse>;
    }).then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load governance."));
  }, [profile]);
  if (loading) return <LoadingState label="Loading compliance workspace…" />;
  if (!profile) return <EmptyState title="Sign in to view compliance" description="Governance records are institution-scoped." />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading evidence lifecycle…" />;
  return <div><PageHeader title="Compliance & governance" description="Evidence-backed lifecycle from requirement through verification, with controlled findings and auditability." />
    <div className="mb-6 grid gap-3 md:grid-cols-3"><Card className="p-4"><ShieldCheck className="text-accent" size={18} /><p className="mt-3 text-xs uppercase tracking-[0.12em] text-muted">Lifecycle stages</p><p className="mt-1 text-2xl font-semibold text-ink">{data.stages.length}</p></Card><Card className="p-4"><p className="text-xs uppercase tracking-[0.12em] text-muted">Evidence chains</p><p className="mt-1 text-2xl font-semibold text-ink">{data.chains.length}</p></Card><Card className="p-4"><p className="text-xs uppercase tracking-[0.12em] text-muted">Findings</p><p className="mt-1 text-2xl font-semibold text-ink">{data.findings.length}</p></Card></div>
    <Card className="p-5"><h2 className="font-semibold text-ink">Findings requiring governance</h2>{data.findings.length === 0 ? <p className="mt-3 text-sm text-muted">No findings are currently recorded for this institution.</p> : <div className="mt-4 space-y-3">{data.findings.map((finding) => <div key={finding.findingId} className="rounded border border-line p-3"><div className="flex justify-between gap-3"><span className="font-medium text-ink">{finding.title}</span><span className="text-xs uppercase text-muted">{finding.status} · {finding.severity}</span></div><p className="mt-1 text-sm text-muted">{finding.description}</p></div>)}</div>}</Card>
  </div>;
}
