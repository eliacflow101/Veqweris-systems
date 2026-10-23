"use client";

import type {
  InstitutionRelationship, MonitoringDomain, MonitoringSignal, PlatformAuditEvent, PlatformCapability,
  PlatformInstitutionSummary, PlatformInstitutionView, PlatformOperator, PlatformRole, PlanFeature, SubscriptionPlan,
  SupportAccessGrant, SupportScope,
} from "./models";

export type PlatformDashboardResponse = {
  institutions: PlatformInstitutionSummary[];
  statistics: {
    total: number; suspended: number; billingEnabled: number; billingExempt: number;
    byRelationship: Record<string, number>; byPlan: Record<string, number>;
    byPlanCategory: Record<string, number>; bySecurityLevel: Record<string, number>;
  };
  plans: SubscriptionPlan[];
  directory: { nextCursor: string | null; pageSize: number; pageCount: number };
  relationships: InstitutionRelationship[];
  supportScopes: SupportScope[];
  supportOperators: Array<{ uid: string; email: string; displayName: string }>;
  platformModules: Array<{ moduleId: string; label: string; section: string }>;
  featureKeys: PlanFeature[];
  operator: { uid: string; email: string; platformRole: PlatformRole; displayName?: string };
};

export type PlatformInstitutionResponse = {
  view?: PlatformInstitutionView;
  grantedScopes?: SupportScope[];
  withheldScopes?: SupportScope[];
  supportAccess?: { grantId: string; scopes: SupportScope[]; expiresAt: string; readOnly: true };
};

type PlatformFailure = { error?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({})) as T & PlatformFailure;
  if (!response.ok) throw new Error(payload.error || `Platform request failed (${response.status}).`);
  return payload;
}

export const platformApi = {
  dashboard: (cursor?: string | null) => request<PlatformDashboardResponse>(
    cursor ? `/api/platform?cursor=${encodeURIComponent(cursor)}` : "/api/platform",
  ),
  institution: (institutionId: string) => request<PlatformInstitutionResponse>(`/api/platform?institutionId=${encodeURIComponent(institutionId)}`),
  operators: () => request<{ operators: PlatformOperator[]; platformRoles: PlatformRole[]; capabilities: PlatformCapability[] }>("/api/platform?operators=1"),
  audit: (institutionId?: string) => request<{ events: PlatformAuditEvent[] }>(
    institutionId ? `/api/platform?audit=1&institutionId=${encodeURIComponent(institutionId)}` : "/api/platform?audit=1&scope=all",
  ),
  action: <T>(body: Record<string, unknown>) => request<T>("/api/platform", { method: "POST", body: JSON.stringify(body) }),
  bootstrap: {
    status: () => request<{ bootstrap: { allowed: boolean; reason: string } }>("/api/platform/bootstrap"),
    claim: () => request<{ operator: { uid: string; platformRole: PlatformRole; status: string } }>("/api/platform/bootstrap", { method: "POST" }),
  },
  subscription: () => request<Record<string, unknown>>("/api/subscription"),
};

export type { InstitutionRelationship, MonitoringDomain, MonitoringSignal, PlatformAuditEvent, PlatformCapability, PlatformInstitutionSummary, PlatformInstitutionView, PlatformOperator, PlatformRole, PlanFeature, SubscriptionPlan, SupportAccessGrant, SupportScope };