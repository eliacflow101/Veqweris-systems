"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/shared/page-shell";
import { useAuth } from "@/lib/auth-context";
import { assistanceRequestStates, type CollaborationContract, type NetworkProfile } from "@/lib/network";

type NetworkResponse = { profile: NetworkProfile | null; profiles: NetworkProfile[]; contracts: CollaborationContract[] };

export default function NetworkPage() {
  const { profile, loading } = useAuth();
  const [data, setData] = useState<NetworkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!profile) return;
    fetch("/api/network").then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error ?? "Unable to load institutional network.");
      return response.json() as Promise<NetworkResponse>;
    }).then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load institutional network."));
  }, [profile]);
  if (loading) return <LoadingState label="Loading institutional network…" />;
  if (!profile) return <EmptyState title="Sign in to view the institutional network" description="Network information is authenticated and institution-scoped." />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading network profiles…" />;
  return <div>
    <PageHeader title="Institutional network" description="A controlled directory for institution-to-institution assistance and approved collaboration. No employee, patient, financial, task, analytics, document, or security data is browsable." />
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-5"><p className="text-xs uppercase tracking-[0.12em] text-muted">Your network profile</p><h2 className="mt-2 font-semibold text-ink">{data.profile?.institutionName ?? "Not published"}</h2><p className="mt-1 text-sm text-muted">{data.profile?.broadLocation ?? "Set a broad location"} · {data.profile?.trustState ?? "Registered"}</p><p className="mt-3 text-sm text-muted">{data.profile?.selectedServices.join(", ") || "No services selected"}</p></Card>
      <Card className="p-5"><p className="text-xs uppercase tracking-[0.12em] text-muted">Visible institutions</p><p className="mt-2 text-3xl font-semibold text-ink">{data.profiles.length}</p><p className="mt-1 text-sm text-muted">Only public network profile fields are shown.</p></Card>
      <Card className="p-5"><p className="text-xs uppercase tracking-[0.12em] text-muted">Collaboration contracts</p><p className="mt-2 text-3xl font-semibold text-ink">{data.contracts.length}</p><p className="mt-1 text-sm text-muted">Mutual approval is required before any workspace access.</p></Card>
    </div>
    <Card className="mt-5 p-5"><h2 className="font-semibold text-ink">Assistance request lifecycle</h2><p className="mt-1 text-sm text-muted">Requests move through explicit, auditable states.</p><div className="mt-4 flex flex-wrap gap-2">{assistanceRequestStates.map((state) => <span key={state} className="rounded-full border border-line px-3 py-1 text-xs text-muted">{state}</span>)}</div></Card>
    <Card className="mt-5 p-5"><h2 className="font-semibold text-ink">Network directory</h2><div className="mt-4 space-y-3">{data.profiles.length === 0 ? <p className="text-sm text-muted">No participating institutions are visible.</p> : data.profiles.map((item) => <div key={item.institutionId} className="rounded border border-line p-3"><div className="flex justify-between gap-3"><span className="font-medium text-ink">{item.institutionName}</span><span className="text-xs uppercase text-muted">{item.trustState}</span></div><p className="mt-1 text-sm text-muted">{item.broadLocation} · {item.selectedServices.join(", ") || "Services not listed"}</p></div>)}</div></Card>
  </div>;
}
