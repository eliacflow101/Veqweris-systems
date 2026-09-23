import type { UserRole } from "@/lib/firebase/models";

export type MetricDomain =
  | "operational" | "financial" | "resource" | "inventory" | "people"
  | "task" | "workflow" | "compliance" | "module"
  | "workforce" | "operations" | "finance" | "education" | "healthcare" | "governance";
export type MetricSensitivity = "public" | "internal" | "confidential" | "restricted";
export type MetricPeriod = "realtime" | "daily" | "weekly" | "monthly" | "quarterly";
export type ReportScope = "institution" | "department";

export interface MetricDefinition {
  metricId: string;
  name: string;
  domain: MetricDomain;
  source: string;
  calculation: string;
  period: MetricPeriod;
  filters: string[];
  permission: UserRole[];
  sensitivity: MetricSensitivity;
  freshness: string;
  aggregation: "count" | "sum" | "average" | "ratio" | "latest";
  sourceEvidence: string[];
}

export interface MetricLineage {
  lineageId: string;
  metricId: string;
  institutionId: string;
  sourceCollection: string;
  sourceQuery: string;
  sourceEvidence: string[];
  calculatedAt: string;
  calculationVersion: string;
}

export interface MetricSnapshot {
  snapshotId: string;
  metricId: string;
  institutionId: string;
  scope: ReportScope;
  departmentId?: string;
  periodStart: string;
  periodEnd: string;
  value: number | null;
  unit?: string;
  status: "ready" | "no_data";
  noDataReason?: "no_records" | "filtered_out" | "not_authorized";
  lineage: MetricLineage;
  createdAt: string;
}

export interface ReportFilters {
  metricIds?: string[];
  domain?: MetricDomain;
  periodStart?: string;
  periodEnd?: string;
  departmentId?: string;
  scope?: ReportScope;
}

export interface ExportAuditRecord {
  exportId: string;
  institutionId: string;
  actorUid: string;
  metricIds: string[];
  scope: ReportScope;
  sensitivity: MetricSensitivity;
  format: "json" | "csv";
  filters: ReportFilters;
  createdAt: string;
}
