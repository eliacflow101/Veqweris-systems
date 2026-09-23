import type { MetricDefinition, MetricLineage, MetricSnapshot, ReportFilters } from "./models";
import { getMetric } from "./registry";

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function deterministicId(prefix: string, value: unknown) {
  let hash = 2166136261;
  for (const character of stable(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildLineage(metric: MetricDefinition, institutionId: string, filters: ReportFilters, calculatedAt = new Date().toISOString()): MetricLineage {
  return {
    lineageId: deterministicId("lin", { metricId: metric.metricId, institutionId, filters }),
    metricId: metric.metricId, institutionId, sourceCollection: metric.source,
    sourceQuery: `institutionId == ${institutionId}${filters.departmentId ? ` AND departmentId == ${filters.departmentId}` : ""}`,
    sourceEvidence: metric.sourceEvidence, calculatedAt, calculationVersion: "stage-17.v1",
  };
}

export function createSnapshot(input: {
  metricId: string; institutionId: string; scope?: "institution" | "department"; departmentId?: string;
  periodStart: string; periodEnd: string; value: number | null; filters?: ReportFilters; calculatedAt?: string;
}): MetricSnapshot {
  const metric = getMetric(input.metricId);
  if (!metric) throw new Error(`Unknown metric: ${input.metricId}`);
  const status = input.value === null ? "no_data" : "ready";
  const filters = input.filters ?? { metricIds: [input.metricId], departmentId: input.departmentId, scope: input.scope ?? "institution" };
  const lineage = buildLineage(metric, input.institutionId, filters, input.calculatedAt);
  return {
    snapshotId: deterministicId("snap", { metricId: input.metricId, institutionId: input.institutionId, scope: input.scope ?? "institution", departmentId: input.departmentId, periodStart: input.periodStart, periodEnd: input.periodEnd }),
    metricId: input.metricId, institutionId: input.institutionId, scope: input.scope ?? "institution", departmentId: input.departmentId,
    periodStart: input.periodStart, periodEnd: input.periodEnd, value: input.value, status,
    noDataReason: status === "no_data" ? "no_records" : undefined, lineage, createdAt: input.calculatedAt ?? new Date().toISOString(),
  };
}
