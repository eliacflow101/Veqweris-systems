"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState, PageHeader, SummaryMetrics } from "@/components/shared/page-shell";
import { useAuth } from "@/lib/auth-context";
import type { SetupSnapshot, SetupState } from "@/lib/setup";

const states: SetupState[] = ["Required", "Recommended", "Optional", "Blocked", "Needs Verification"];

export default function SetupPage() {
  const { profile, loading } = useAuth();
  const [data, setData] = useState<SetupSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => { if (profile) fetch("/api/setup").then(async (response) => { if (!response.ok) throw new Error((await response.json()).error ?? "Unable to load setup."); return response.json() as Promise<SetupSnapshot>; }).then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load setup.")); };
  useEffect(load, [profile]);
  async function update(requirementId: string, state: SetupState) {
    const response = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_requirement", requirementId, state }) });
    if (!response.ok) { setError("Unable to update setup requirement."); return; }
    load();
  }
  async function reviewRecommendation(recommendationId: string, recommendationState: "Accepted" | "Dismissed" | "Needs Review") {
    const response = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review_recommendation", recommendationId, recommendationState }) });
    if (!response.ok) { setError("Unable to save recommendation review."); return; }
    load();
  }
  if (loading) return <LoadingState label="Loading readiness center…" />;
  if (!profile) return <EmptyState title="Sign in to configure readiness" description="Setup is scoped to your institution." />;
  if (error) return <ErrorState message={error} onRetry={() => { setError(null); load(); }} />;
  if (!data) return <LoadingState label="Loading setup requirements…" />;
  return <div><PageHeader title="Institution setup & readiness" description="A configuration-driven checklist for secure, operational readiness across your enabled modules." />
    <SummaryMetrics items={[{ label: "Readiness", value: data.progress.readiness }, { label: "Progress", value: `${data.progress.percent}%`, hint: `${data.progress.completed}/${data.progress.total}` }, { label: "Required", value: `${data.progress.requiredCompleted}/${data.progress.required}` }, { label: "Departments", value: data.recommendations.filter((item) => item.state === "Recommended").length, hint: "to review" }]} />
    <div className="space-y-3">{data.requirements.map((item) => <Card key={item.requirementId} className="p-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><p className="text-xs uppercase tracking-[0.12em] text-muted">{item.dimension} · {item.module}</p><h2 className="mt-1 font-semibold text-ink">{item.title}</h2><p className="mt-1 text-sm text-muted">{item.verification?.reason ?? item.description}</p>{item.verification?.satisfied ? <p className="mt-2 text-xs text-accent">Verified from current institution data.</p> : null}</div><select aria-label={`Review state for ${item.title}`} value={item.state === "Completed" ? "Completed" : item.state} disabled={item.state === "Completed"} onChange={(event) => update(item.requirementId, event.target.value as SetupState)} className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">{item.state === "Completed" ? <option>Completed</option> : states.map((state) => <option key={state}>{state}</option>)}</select></div></Card>)}</div>
    <Card className="mt-6 p-5"><h2 className="font-semibold text-ink">Department recommendations</h2><div className="mt-3 grid gap-3 md:grid-cols-2">{data.recommendations.map((recommendation) => <div key={recommendation.recommendationId} className="rounded border border-line p-3"><p className="font-medium text-ink">{recommendation.name}</p><p className="mt-1 text-sm text-muted">{recommendation.reason}</p><p className="mt-2 text-xs text-muted">Status: {recommendation.state}</p><div className="mt-3 flex flex-wrap gap-2"><Link href="/departments" className="inline-flex h-8 items-center rounded-md border border-line px-3 text-sm font-medium text-ink hover:bg-surface-raised">Review in Departments</Link>{(["Accepted", "Dismissed", "Needs Review"] as const).map((state) => <button key={state} type="button" onClick={() => reviewRecommendation(recommendation.recommendationId, state)} className="rounded-md border border-line px-3 py-1 text-xs text-ink hover:bg-surface-raised">{state}</button>)}</div></div>)}</div></Card>
  </div>;
}
