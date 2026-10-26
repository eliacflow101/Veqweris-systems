/**
 * Stage 24 — VEQWERIS Platform Administration domain.
 *
 * This module is intentionally dependency-free: it must never import institution
 * session code, React, or Firebase so it can be used by the platform engine, the
 * platform API routes, and pure tests alike.
 *
 * Platform identity is deliberately NOT a `UserRole`. Institution roles
 * (Owner/Admin/Manager/Employee + vertical roles) can never reach the platform
 * console because platform authorization is resolved from a separate
 * `platformOperators` record, never from `users.role`.
 */

/** Platform-level roles. Separate from `UserRole` by design. */
export const platformRoles = ["Platform Owner", "Platform Administrator", "Platform Support", "Platform Analyst"] as const;
export type PlatformRole = (typeof platformRoles)[number];

export type PlatformCapability =
  | "institutions.view"
  | "institutions.manage"
  | "plans.assign"
  | "plans.manage"
  | "relationships.assign"
  | "features.manage"
  | "billing.manage"
  | "network.trust.manage"
  | "monitoring.view"
  | "monitoring.manage"
  | "support.grant"
  | "audit.view"
  | "operators.manage";

export const platformCapabilities: PlatformCapability[] = [
  "institutions.view", "institutions.manage", "plans.assign", "plans.manage", "relationships.assign",
  "features.manage", "billing.manage", "network.trust.manage", "monitoring.view", "monitoring.manage", "support.grant",
  "audit.view", "operators.manage",
];

export type PlatformOperatorStatus = "active" | "suspended" | "revoked";

/** Server-managed platform operator record (`platformOperators/{uid}`). */
export interface PlatformOperator {
  uid: string;
  email: string;
  displayName?: string;
  platformRole: PlatformRole;
  status: PlatformOperatorStatus;
  grantedBy: string;
  grantReason: string;
  grantedAt: string;
  updatedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

/* -------------------------------------------------------------------------- */
/* Relationship types (independent of subscription plan)                      */
/* -------------------------------------------------------------------------- */

export const institutionRelationships = [
  "Internal",
  "Strategic Partner",
  "Customer",
  "Educational Partner",
  "Reseller",
  "Demonstration Institution",
] as const;
export type InstitutionRelationship = (typeof institutionRelationships)[number];
export const defaultInstitutionRelationship: InstitutionRelationship = "Customer";

/* -------------------------------------------------------------------------- */
/* Subscription plans                                                          */
/* -------------------------------------------------------------------------- */

export const subscriptionPlanIds = ["internal", "developer", "partner", "basic", "professional", "enterprise"] as const;
export type SubscriptionPlanId = (typeof subscriptionPlanIds)[number];

/** `internal` and `partner` plans are platform-managed and never shown to commercial customers. */
export type SubscriptionPlanCategory = "internal" | "partner" | "commercial";

export type PlanAudience = "customer" | "platform";

export const UNLIMITED = -1;

export interface PlanLimits {
  maxUsers: number;
  maxDepartments: number;
  maxStorageMb: number;
  maxMonthlyNotifications: number;
  maxIntegrationEndpoints: number;
}

export const planFeatureKeys = [
  "external-integrations",
  "institutional-network",
  "document-automation",
  "data-export",
  "multi-vertical",
  "priority-support",
  "white-label-footer",
] as const;
export type PlanFeature = (typeof planFeatureKeys)[number];

/** Module ids that every operational institution receives. */
export const coreModuleIds: string[] = [
  "dashboard", "departments", "employees", "tasks", "planner", "messages",
  "notifications", "documents", "reports", "approvals", "settings", "inventory", "setup",
];

/** Core plus the intelligence/governance modules. */
export const extendedModuleIds: string[] = [
  ...coreModuleIds, "compliance", "analytics", "operational-intelligence", "network",
  "school", "healthcare", "hospitality",
];

export type ModuleScope = "core" | "extended" | "all";

export interface SubscriptionPlan {
  planId: SubscriptionPlanId;
  name: string;
  category: SubscriptionPlanCategory;
  description: string;
  /** Data-driven billing behaviour: no per-institution exceptions exist in code. */
  billingEnabled: boolean;
  invoicesEnabled: boolean;
  premiumFeatures: boolean;
  moduleScope: ModuleScope;
  features: PlanFeature[] | "all";
  limits: PlanLimits;
  /** Plans a platform administrator may migrate this plan to. */
  migrationTargets: SubscriptionPlanId[];
  /** Commercial plans are the only plans an institution may ever see or request. */
  visibleToCustomers: boolean;
  status: "active" | "deprecated";
}

/** Legacy stored plan ids map onto a current plan instead of failing. */
export const legacyPlanAliases: Record<string, SubscriptionPlanId> = { trial: "basic" };

export type SubscriptionStatus = "active" | "suspended" | "not_applicable" | "none";

export interface InstitutionSubscription {
  planId: SubscriptionPlanId;
  planName: string;
  category: SubscriptionPlanCategory;
  status: SubscriptionStatus;
  billingEnabled: boolean;
  invoicesEnabled: boolean;
  premiumFeatures: boolean;
  renewalPolicy: "monthly" | "none";
  startedAt: string;
  assignedAt: string;
  assignedBy: string;
  migratedFrom?: SubscriptionPlanId;
}

/* -------------------------------------------------------------------------- */
/* Platform-managed institution state                                         */
/* -------------------------------------------------------------------------- */

export interface InstitutionEntitlementOverrides {
  modules?: string[];
  features?: PlanFeature[];
  limits?: Partial<PlanLimits>;
}

export interface InstitutionEntitlement {
  planId: SubscriptionPlanId;
  modules: string[];
  features: PlanFeature[];
  limits: PlanLimits;
  overrides: InstitutionEntitlementOverrides;
  updatedAt: string;
  updatedBy: string;
}

export interface InstitutionPolicies {
  allowExternalIntegrations: boolean;
  allowNetworkParticipation: boolean;
  allowDataExport: boolean;
  requireSensitiveReauth: boolean;
  supportAccessEnabled: boolean;
}

export const defaultInstitutionPolicies: InstitutionPolicies = {
  allowExternalIntegrations: false,
  allowNetworkParticipation: false,
  allowDataExport: false,
  requireSensitiveReauth: true,
  supportAccessEnabled: false,
};

export const institutionSecurityLevels = ["standard", "elevated", "restricted"] as const;
export type InstitutionSecurityLevel = (typeof institutionSecurityLevels)[number];

export interface InstitutionSecurityState {
  level: InstitutionSecurityLevel;
  reason: string;
  updatedAt: string;
  updatedBy: string;
}

export const institutionBillingStatuses = ["not_applicable", "trialing", "current", "due", "suspended"] as const;
export type InstitutionBillingStatus = (typeof institutionBillingStatuses)[number];

export interface InstitutionBillingState {
  status: InstitutionBillingStatus;
  currency: string;
  invoicesEnabled: boolean;
  lastInvoiceAt?: string | null;
  nextInvoiceAt?: string | null;
  note?: string;
}

export type InstitutionLifecycleStatus = "active" | "suspended";

/** The platform-owned projection stored on `institutions/{institutionId}`. */
export interface InstitutionPlatformState {
  institutionId: string;
  status: InstitutionLifecycleStatus;
  relationship: InstitutionRelationship;
  planTier: SubscriptionPlanId;
  subscription: InstitutionSubscription;
  entitlement: InstitutionEntitlement;
  policies: InstitutionPolicies;
  securityState: InstitutionSecurityState;
  billingState: InstitutionBillingState;
  platformUpdatedAt?: string;
  platformUpdatedBy?: string;
}

/* -------------------------------------------------------------------------- */
/* Usage, health and monitoring                                                */
/* -------------------------------------------------------------------------- */

export interface InstitutionUsageSnapshot {
  institutionId: string;
  users: number | null;
  activeUsers: number | null;
  departments: number | null;
  documents: number | null;
  storageBytes: number | null;
  tasks: number | null;
  notifications: number | null;
  payments: number | null;
  auditEvents: number | null;
  securityEvents: number | null;
  imports: number | null;
  integrationExceptions: number | null;
  integrations: number | null;
  generatedAt: string;
  /** Signals that could not be measured. They are reported, never invented. */
  unavailable: string[];
}

export const monitoringDomains = [
  "activity", "performance", "errors", "security", "storage",
  "reads", "writes", "listeners", "bandwidth", "functions", "queues",
  "imports", "payments", "notifications",
] as const;
export type MonitoringDomain = (typeof monitoringDomains)[number];

export type MonitoringAvailability = "available" | "unavailable";
export type MonitoringSource = "firestore-aggregate" | "ingested-signal" | "operator-entry" | "unavailable";

export interface MonitoringObservation {
  domain: MonitoringDomain;
  availability: MonitoringAvailability;
  value: number | null;
  unit: string | null;
  source: MonitoringSource;
  reason: string;
  evidence: string[];
}

export interface MonitoringSummary {
  observations: MonitoringObservation[];
  available: number;
  unavailable: number;
  complete: boolean;
  evaluatedAt: string;
}

export interface MonitoringSignal {
  signalId: string;
  institutionId: string | null;
  domain: MonitoringDomain;
  metric: string;
  value: number;
  unit: string;
  source: "platform-agent" | "operator-entry";
  note: string;
  capturedAt: string;
  recordedBy: string;
}

export type InstitutionHealthLevel = "healthy" | "attention" | "critical" | "unknown";

export interface InstitutionHealth {
  level: InstitutionHealthLevel;
  reasons: string[];
  evaluatedAt: string;
}

export interface LimitViolation {
  limit: keyof PlanLimits;
  allowed: number;
  actual: number;
  message: string;
}

/* -------------------------------------------------------------------------- */
/* Support access (auditable, scoped, never impersonation)                    */
/* -------------------------------------------------------------------------- */

export const supportScopes = [
  "institution.overview",
  "usage.view",
  "billing.view",
  "security.view",
  "audit.view",
] as const;
export type SupportScope = (typeof supportScopes)[number];

export const SUPPORT_MAX_DURATION_MINUTES = 480;
export const SUPPORT_DEFAULT_DURATION_MINUTES = 60;

export interface SupportAccessGrant {
  grantId: string;
  institutionId: string;
  operatorUid: string;
  operatorRole: PlatformRole;
  scopes: SupportScope[];
  reason: string;
  /** Support access is read-only, time-limited and always visible to the institution. */
  readOnly: true;
  status: "active" | "revoked" | "expired";
  grantedAt: string;
  expiresAt: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Platform audit                                                             */
/* -------------------------------------------------------------------------- */

export interface PlatformAuditEvent {
  eventId: string;
  scope: "platform";
  actorUid: string;
  actorEmail: string | null;
  actorPlatformRole: PlatformRole;
  action: string;
  targetInstitutionId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  previousHash: string | null;
  hash: string;
  sequence: number;
}

/* -------------------------------------------------------------------------- */
/* Institution administration view                                            */
/* -------------------------------------------------------------------------- */

export interface PlatformInstitutionSummary {
  institutionId: string;
  name: string;
  country: string;
  status: InstitutionLifecycleStatus;
  relationship: InstitutionRelationship;
  planId: SubscriptionPlanId;
  planName: string;
  planCategory: SubscriptionPlanCategory;
  billingEnabled: boolean;
  securityLevel: InstitutionSecurityLevel;
  modules: string[];
  updatedAt?: string;
}

export interface PlatformInstitutionView extends PlatformInstitutionSummary {
  networkTrustState?: "Registered" | "Verified" | "Trusted Network Member" | "Enterprise Partner" | "Restricted" | "Suspended" | "Revoked";
  plan: {
    planId: SubscriptionPlanId;
    name: string;
    category: SubscriptionPlanCategory;
    billingEnabled: boolean;
    invoicesEnabled: boolean;
    premiumFeatures: boolean;
    moduleScope: ModuleScope;
    migrationTargets: SubscriptionPlanId[];
    visibleToCustomers: boolean;
  };
  subscription: InstitutionSubscription;
  entitlement: InstitutionEntitlement;
  policies: InstitutionPolicies;
  securityState: InstitutionSecurityState;
  billingState: InstitutionBillingState;
  health: InstitutionHealth;
  usage: InstitutionUsageSnapshot | null;
  monitoring: MonitoringSummary;
  limitViolations: LimitViolation[];
  supportGrants: SupportAccessGrant[];
  createdAt?: string;
}

export type SupportScopedInstitutionView = Omit<
  PlatformInstitutionView,
  | "planId"
  | "planName"
  | "planCategory"
  | "billingEnabled"
  | "securityLevel"
  | "modules"
  | "networkTrustState"
  | "plan"
  | "subscription"
  | "entitlement"
  | "policies"
  | "securityState"
  | "billingState"
  | "health"
> & Partial<Pick<
  PlatformInstitutionView,
  | "planId"
  | "planName"
  | "planCategory"
  | "billingEnabled"
  | "securityLevel"
  | "modules"
  | "networkTrustState"
  | "plan"
  | "subscription"
  | "entitlement"
  | "policies"
  | "securityState"
  | "billingState"
  | "health"
>>;

export interface PlatformAccessContext {
  operator: PlatformOperator;
  capabilities: PlatformCapability[];
  activeSupportInstitutionIds: string[];
}

/** A support operator sees only the sections granted by an explicit support grant. */
export interface SupportScopedView {
  view: SupportScopedInstitutionView;
  grantedScopes: SupportScope[];
  withheldScopes: SupportScope[];
}
