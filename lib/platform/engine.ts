import { deterministicId } from "@/lib/governance";
import {
  coreModuleIds, extendedModuleIds, legacyPlanAliases, defaultInstitutionPolicies,
  defaultInstitutionRelationship, institutionRelationships, planFeatureKeys, subscriptionPlanIds,
  supportScopes, SUPPORT_DEFAULT_DURATION_MINUTES, SUPPORT_MAX_DURATION_MINUTES,
  platformCapabilities, UNLIMITED,
} from "./models";
import type {
  InstitutionBillingState, InstitutionEntitlement, InstitutionEntitlementOverrides, InstitutionHealth,
  InstitutionHealthLevel, InstitutionPolicies, InstitutionPlatformState, InstitutionRelationship,
  InstitutionSecurityLevel, InstitutionSecurityState, InstitutionSubscription, InstitutionUsageSnapshot,
  LimitViolation, MonitoringDomain, MonitoringObservation, MonitoringSignal, MonitoringSummary,
  PlanAudience, PlanFeature, PlanLimits, PlatformCapability, PlatformInstitutionSummary,
  PlatformInstitutionView, PlatformOperator, PlatformRole, SubscriptionPlan, SubscriptionPlanId,
  SupportAccessGrant, SupportScope, SupportScopedView,
} from "./models";

/* -------------------------------------------------------------------------- */
/* Subscription plan registry (single source of truth — no code exceptions)    */
/* -------------------------------------------------------------------------- */

const unlimitedLimits: PlanLimits = {
  maxUsers: UNLIMITED, maxDepartments: UNLIMITED, maxStorageMb: UNLIMITED,
  maxMonthlyNotifications: UNLIMITED, maxIntegrationEndpoints: UNLIMITED,
};

export const subscriptionPlans: SubscriptionPlan[] = [
  {
    planId: "internal", name: "Internal", category: "internal",
    description: "VEQWERIS internal operating plan. Billing is disabled and every capability is available.",
    billingEnabled: false, invoicesEnabled: false, premiumFeatures: true,
    moduleScope: "all", features: "all", limits: { ...unlimitedLimits },
    migrationTargets: ["developer", "partner"], visibleToCustomers: false,
    status: "active",
  },
  {
    planId: "developer", name: "Developer", category: "internal",
    description: "Engineering and verification plan for pre-release and harness institutions.",
    billingEnabled: false, invoicesEnabled: false, premiumFeatures: true,
    moduleScope: "all", features: "all",
    limits: { maxUsers: 25, maxDepartments: 10, maxStorageMb: 5120, maxMonthlyNotifications: 25000, maxIntegrationEndpoints: 10 },
    migrationTargets: ["internal", "professional", "enterprise"], visibleToCustomers: false,
    status: "active",
  },
  {
    planId: "partner", name: "Partner", category: "partner",
    description: "Strategic, educational and reseller partner plan. Billing is disabled and remains migratable to a commercial plan.",
    billingEnabled: false, invoicesEnabled: false, premiumFeatures: true,
    moduleScope: "all", features: "all",
    limits: { maxUsers: 250, maxDepartments: 50, maxStorageMb: 51200, maxMonthlyNotifications: 250000, maxIntegrationEndpoints: 50 },
    migrationTargets: ["professional", "enterprise"], visibleToCustomers: false,
    status: "active",
  },
  {
    planId: "basic", name: "Basic", category: "commercial",
    description: "Default commercial plan assigned at registration. Core operations with invoiced billing.",
    billingEnabled: true, invoicesEnabled: true, premiumFeatures: false,
    moduleScope: "core", features: [],
    limits: { maxUsers: 25, maxDepartments: 8, maxStorageMb: 2048, maxMonthlyNotifications: 5000, maxIntegrationEndpoints: 2 },
    migrationTargets: ["professional", "enterprise"], visibleToCustomers: true,
    status: "active",
  },
  {
    planId: "professional", name: "Professional", category: "commercial",
    description: "Commercial plan for multi-department institutions that need intelligence and governance modules.",
    billingEnabled: true, invoicesEnabled: true, premiumFeatures: true,
    moduleScope: "extended",
    features: ["external-integrations", "institutional-network", "document-automation", "data-export"],
    limits: { maxUsers: 150, maxDepartments: 40, maxStorageMb: 20480, maxMonthlyNotifications: 50000, maxIntegrationEndpoints: 10 },
    migrationTargets: ["basic", "enterprise"], visibleToCustomers: true,
    status: "active",
  },
  {
    planId: "enterprise", name: "Enterprise", category: "commercial",
    description: "Commercial plan with unlimited operational scale, every module and every capability.",
    billingEnabled: true, invoicesEnabled: true, premiumFeatures: true,
    moduleScope: "all", features: "all", limits: { ...unlimitedLimits },
    migrationTargets: ["professional"], visibleToCustomers: true,
    status: "active",
  },
];

export const defaultCommercialPlanId: SubscriptionPlanId = "basic";

export function isSubscriptionPlanId(value: unknown): value is SubscriptionPlanId {
  return typeof value === "string" && (subscriptionPlanIds as readonly string[]).includes(value);
}

/** Canonicalises stored plan ids, including legacy values such as `trial`. */
export function canonicalPlanId(value: unknown): SubscriptionPlanId {
  if (isSubscriptionPlanId(value)) return value;
  if (typeof value === "string" && value in legacyPlanAliases) return legacyPlanAliases[value];
  return defaultCommercialPlanId;
}

export function getPlan(planId: unknown, plans: SubscriptionPlan[] = subscriptionPlans): SubscriptionPlan | undefined {
  return plans.find((plan) => plan.planId === canonicalPlanId(planId));
}

export function requirePlan(planId: unknown, plans: SubscriptionPlan[] = subscriptionPlans): SubscriptionPlan {
  const known = isSubscriptionPlanId(planId) || (typeof planId === "string" && planId in legacyPlanAliases);
  if (!known) throw new Error("Unknown subscription plan.");
  const plan = plans.find((candidate) => candidate.planId === canonicalPlanId(planId));
  if (!plan) throw new Error("Subscription plan is missing from the managed catalog.");
  return plan;
}

/** Read path resilience: an unrecognised stored value falls back to the default commercial plan. */
export function planOrDefault(planId: unknown, plans: SubscriptionPlan[] = subscriptionPlans): SubscriptionPlan {
  return getPlan(planId, plans) ?? requirePlan(defaultCommercialPlanId, plans);
}

/** Commercial institutions may only ever see commercial plans. */
export function listPlans(audience: PlanAudience, plans: SubscriptionPlan[] = subscriptionPlans): SubscriptionPlan[] {
  const visible = plans.filter((plan) => plan.status !== "deprecated"
    && (audience !== "customer" || (plan.category === "commercial" && plan.visibleToCustomers)));
  return visible.sort((a, b) => a.planId.localeCompare(b.planId));
}

export function validateManagedPlan(value: unknown, expectedPlanId?: SubscriptionPlanId): SubscriptionPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Plan catalog entry must be an object.");
  const plan = value as Partial<SubscriptionPlan>;
  if (!isSubscriptionPlanId(plan.planId) || (expectedPlanId && plan.planId !== expectedPlanId)) {
    throw new Error("Plan catalog entry has an invalid plan identifier.");
  }
  const seed = subscriptionPlans.find(({ planId }) => planId === plan.planId)!;
  if (plan.category !== seed.category) throw new Error("Plan category is immutable.");
  if (typeof plan.name !== "string" || !plan.name.trim() || plan.name.length > 80
    || typeof plan.description !== "string" || !plan.description.trim() || plan.description.length > 500) {
    throw new Error("Plan name and description are required and must be within their length limits.");
  }
  if (typeof plan.billingEnabled !== "boolean" || typeof plan.invoicesEnabled !== "boolean"
    || typeof plan.premiumFeatures !== "boolean" || typeof plan.visibleToCustomers !== "boolean"
    || (plan.status !== "active" && plan.status !== "deprecated")) {
    throw new Error("Plan billing, visibility, feature, or lifecycle settings are invalid.");
  }
  if (plan.invoicesEnabled && !plan.billingEnabled) throw new Error("Invoices require billing to be enabled.");
  if (plan.visibleToCustomers && plan.category !== "commercial") throw new Error("Only commercial plans may be visible to customers.");
  if (plan.moduleScope !== "core" && plan.moduleScope !== "extended" && plan.moduleScope !== "all") {
    throw new Error("Plan module scope is invalid.");
  }
  const featureKeys = planFeatureKeys as readonly string[];
  if (plan.features !== "all" && (!Array.isArray(plan.features)
    || plan.features.some((feature) => typeof feature !== "string" || !featureKeys.includes(feature)))) {
    throw new Error("Plan features contain unsupported values.");
  }
  if (!plan.limits || typeof plan.limits !== "object"
    || !["maxUsers", "maxDepartments", "maxStorageMb", "maxMonthlyNotifications", "maxIntegrationEndpoints"]
      .every((key) => Number.isSafeInteger(plan.limits?.[key as keyof PlanLimits]) && (plan.limits?.[key as keyof PlanLimits] ?? 0) >= UNLIMITED)) {
    throw new Error("Plan limits must be safe non-negative integers or -1 for unlimited.");
  }
  if (!Array.isArray(plan.migrationTargets)
    || plan.migrationTargets.some((id) => !isSubscriptionPlanId(id) || id === plan.planId)
    || new Set(plan.migrationTargets).size !== plan.migrationTargets.length) {
    throw new Error("Plan migration targets are invalid.");
  }
  return {
    planId: plan.planId,
    name: plan.name.trim(),
    category: plan.category,
    description: plan.description.trim(),
    billingEnabled: plan.billingEnabled,
    invoicesEnabled: plan.invoicesEnabled,
    premiumFeatures: plan.premiumFeatures,
    moduleScope: plan.moduleScope,
    features: plan.features,
    limits: { ...plan.limits },
    migrationTargets: [...plan.migrationTargets],
    visibleToCustomers: plan.visibleToCustomers,
    status: plan.status,
  };
}

export function defaultPlanForNewInstitution(plans: SubscriptionPlan[] = subscriptionPlans): SubscriptionPlan {
  return requirePlan(defaultCommercialPlanId, plans);
}

/* -------------------------------------------------------------------------- */
/* Module catalogue (derived from the live navigation configuration)           */
/* -------------------------------------------------------------------------- */

export type PlatformModuleCatalogueInput = {
  label: string;
  href: string;
  section: string;
  requiredModule?: string;
  platformOnly?: boolean;
  visibility?: "visible" | "future" | "disabled";
};

export type PlatformModuleEntry = { moduleId: string; label: string; section: string; platformOnly: boolean };

export function platformModuleCatalogue(items: PlatformModuleCatalogueInput[]): PlatformModuleEntry[] {
  return catalogueEntries(items);
}

/** Modules an institution can ever be entitled to: live surface only, never platform-only. */
export function tenantModuleCatalogue(items: PlatformModuleCatalogueInput[]): PlatformModuleEntry[] {
  return catalogueEntries(items.filter((item) => !item.platformOnly && item.visibility !== "future" && item.visibility !== "disabled"));
}

function catalogueEntries(items: PlatformModuleCatalogueInput[]): PlatformModuleEntry[] {
  const seen = new Map<string, PlatformModuleEntry>();
  for (const item of items) {
    if (!item.requiredModule || seen.has(item.requiredModule)) continue;
    seen.set(item.requiredModule, {
      moduleId: item.requiredModule, label: item.label, section: item.section,
      platformOnly: Boolean(item.platformOnly),
    });
  }
  return [...seen.values()].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
}

export function planModuleScope(plan: SubscriptionPlan, tenantModules: PlatformModuleEntry[]): string[] {
  const ids = tenantModules.map((entry) => entry.moduleId);
  if (plan.moduleScope === "all") return ids;
  const allowed = plan.moduleScope === "extended" ? new Set(extendedModuleIds) : new Set(coreModuleIds);
  return ids.filter((id) => allowed.has(id));
}

export function resolvePlanFeatures(plan: SubscriptionPlan): PlanFeature[] {
  return plan.features === "all" ? [...planFeatureKeys] : [...plan.features];
}

export function validateModuleSelection(selected: unknown, tenantModules: PlatformModuleEntry[]) {
  const ids = Array.isArray(selected) ? selected.filter((value): value is string => typeof value === "string") : [];
  const known = new Set(tenantModules.map((entry) => entry.moduleId));
  return {
    valid: [...new Set(ids.filter((id) => known.has(id)))],
    unknown: [...new Set(ids.filter((id) => !known.has(id)))],
  };
}

export function validateFeatureSelection(selected: unknown) {
  const values = Array.isArray(selected) ? selected.filter((value): value is string => typeof value === "string") : [];
  const known = new Set<string>(planFeatureKeys);
  return {
    valid: [...new Set(values.filter((value) => known.has(value)))] as PlanFeature[],
    unknown: [...new Set(values.filter((value) => !known.has(value)))],
  };
}

export function isFeatureEnabled(features: string[], feature: PlanFeature) {
  return features.includes(feature);
}

export function isModuleEnabled(modules: string[], moduleId: string) {
  return modules.includes(moduleId);
}

/* -------------------------------------------------------------------------- */
/* Entitlements (effective modules, features and limits)                      */
/* -------------------------------------------------------------------------- */

export type EntitlementContext = { tenantModules: PlatformModuleEntry[]; plans?: SubscriptionPlan[] };

export function resolveEntitlement(
  plan: SubscriptionPlan,
  overrides: InstitutionEntitlementOverrides,
  actorUid: string,
  now: string,
  context: EntitlementContext,
): InstitutionEntitlement {
  const planModules = planModuleScope(plan, context.tenantModules);
  const known = new Set(context.tenantModules.map((entry) => entry.moduleId));
  const overrideModules = (overrides.modules ?? []).filter((id) => known.has(id));
  const planFeatures = resolvePlanFeatures(plan);
  const overrideFeatures = (overrides.features ?? []).filter((feature) => (planFeatureKeys as readonly string[]).includes(feature));
  const features = [...new Set([...planFeatures, ...overrideFeatures])];
  const limits: PlanLimits = { ...plan.limits, ...(overrides.limits ?? {}) };
  const hasOverrides = Boolean(overrides.modules || overrides.features || overrides.limits);
  return {
    planId: plan.planId,
    // Platform grants are additive: granted modules and plan modules are both honoured.
    modules: [...new Set([...planModules, ...overrideModules])].sort(),
    features,
    limits,
    overrides: hasOverrides ? { ...overrides } : {},
    updatedAt: now,
    updatedBy: actorUid,
  };
}

export function updateEntitlementOverrides(
  entitlement: InstitutionEntitlement,
  overrides: InstitutionEntitlementOverrides,
  actorUid: string,
  now: string,
  context: EntitlementContext,
): InstitutionEntitlement {
  const plan = requirePlan(entitlement.planId, context.plans);
  return resolveEntitlement(plan, { ...entitlement.overrides, ...overrides }, actorUid, now, context);
}

export function evaluateLimitViolations(limits: PlanLimits, usage: InstitutionUsageSnapshot | null): LimitViolation[] {
  if (!usage) return [];
  const checks: Array<{ limit: keyof PlanLimits; actual: number | null; label: string; unit: string }> = [
    { limit: "maxUsers", actual: usage.users, label: "users", unit: "users" },
    { limit: "maxDepartments", actual: usage.departments, label: "departments", unit: "departments" },
    ...(usage.storageBytes === null ? [] : [{ limit: "maxStorageMb" as const, actual: Math.ceil(usage.storageBytes / (1024 * 1024)), label: "storage", unit: "MB" }]),
    { limit: "maxMonthlyNotifications", actual: usage.notifications, label: "notifications", unit: "notifications" },
    { limit: "maxIntegrationEndpoints", actual: usage.integrations, label: "integration endpoints", unit: "endpoints" },
  ];
  return checks.flatMap(({ limit, actual, label, unit }) =>
    actual === null || limits[limit] === UNLIMITED || actual <= limits[limit]
      ? []
      : [{
        limit,
        allowed: limits[limit],
        actual,
        message: `${label} usage ${actual} ${unit} exceeds the plan limit of ${limits[limit]}.`,
      }],
  );
}

/* -------------------------------------------------------------------------- */
/* Subscription and billing behaviour (derived from the plan, never hard-coded)*/
/* -------------------------------------------------------------------------- */

function nextInvoiceDue(now: string) {
  const date = new Date(now);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString();
}

export function deriveBillingState(plan: SubscriptionPlan, previous?: InstitutionBillingState, now = new Date().toISOString()): InstitutionBillingState {
  const currency = previous?.currency ?? "USD";
  if (!plan.billingEnabled) {
    return {
      status: "not_applicable",
      currency,
      invoicesEnabled: false,
      lastInvoiceAt: previous?.lastInvoiceAt ?? null,
      nextInvoiceAt: null,
      note: `${plan.name} plan: billing and invoicing are disabled; premium features remain available`,
    };
  }
  return {
    status: previous?.status === "suspended" ? "suspended" : previous?.status === "due" ? "due" : "current",
    currency,
    invoicesEnabled: plan.invoicesEnabled,
    lastInvoiceAt: previous?.lastInvoiceAt ?? null,
    nextInvoiceAt: nextInvoiceDue(now),
    ...(previous?.note ? { note: previous.note } : {}),
  };
}

export function deriveSubscription(
  plan: SubscriptionPlan,
  previous: InstitutionSubscription | undefined,
  actorUid: string,
  now: string,
): InstitutionSubscription {
  const samePlan = previous?.planId === plan.planId;
  return {
    planId: plan.planId,
    planName: plan.name,
    category: plan.category,
    status: plan.billingEnabled ? (previous?.status === "suspended" ? "suspended" : "active") : "not_applicable",
    billingEnabled: plan.billingEnabled,
    invoicesEnabled: plan.invoicesEnabled,
    premiumFeatures: plan.premiumFeatures,
    renewalPolicy: plan.billingEnabled ? "monthly" : "none",
    startedAt: samePlan && previous ? previous.startedAt : now,
    assignedAt: now,
    assignedBy: actorUid,
    ...(previous && !samePlan ? { migratedFrom: previous.planId } : {}),
  };
}

export function defaultPlatformState(
  institutionId: string,
  actorUid: string,
  now: string,
  context: EntitlementContext,
): InstitutionPlatformState {
  const plan = defaultPlanForNewInstitution(context.plans);
  return {
    institutionId,
    status: "active",
    relationship: defaultInstitutionRelationship,
    planTier: plan.planId,
    subscription: deriveSubscription(plan, undefined, actorUid, now),
    entitlement: resolveEntitlement(plan, {}, actorUid, now, context),
    policies: { ...defaultInstitutionPolicies },
    securityState: { level: "standard", reason: "Default platform security posture.", updatedAt: now, updatedBy: actorUid },
    billingState: deriveBillingState(plan, undefined, now),
    platformUpdatedAt: now,
    platformUpdatedBy: actorUid,
  };
}

/* -------------------------------------------------------------------------- */
/* Platform state changes (relationship and plan stay independent)            */
/* -------------------------------------------------------------------------- */

export function assignPlan(
  state: InstitutionPlatformState,
  planId: unknown,
  actorUid: string,
  now = new Date().toISOString(),
  context: EntitlementContext,
): InstitutionPlatformState {
  const plan = requirePlan(planId, context.plans);
  const currentPlan = requirePlan(state.planTier, context.plans);
  assertPlanMigrationAllowed(currentPlan, plan);
  return {
    ...state,
    planTier: plan.planId,
    subscription: deriveSubscription(plan, state.subscription, actorUid, now),
    entitlement: resolveEntitlement(plan, state.entitlement.overrides, actorUid, now, context),
    billingState: deriveBillingState(plan, state.billingState, now),
    platformUpdatedAt: now,
    platformUpdatedBy: actorUid,
  };
}

export function assertPlanMigrationAllowed(currentPlan: SubscriptionPlan, targetPlan: SubscriptionPlan) {
  if (targetPlan.status !== "active") throw new Error("PLAN_INACTIVE");
  if (currentPlan.planId !== targetPlan.planId && !currentPlan.migrationTargets.includes(targetPlan.planId)) {
    throw new Error("PLAN_MIGRATION_NOT_ALLOWED");
  }
}

/** Relationship is a governance attribute; it never rewrites the subscription plan. */
export function assignRelationship(
  state: InstitutionPlatformState,
  relationship: unknown,
  actorUid: string,
  now = new Date().toISOString(),
): InstitutionPlatformState {
  if (typeof relationship !== "string" || !(institutionRelationships as readonly string[]).includes(relationship)) {
    throw new Error("Unknown institution relationship type.");
  }
  return { ...state, relationship: relationship as InstitutionPlatformState["relationship"], platformUpdatedAt: now, platformUpdatedBy: actorUid };
}

export function updateInstitutionStatus(
  state: InstitutionPlatformState,
  status: "active" | "suspended",
  actorUid: string,
  now = new Date().toISOString(),
  plans: SubscriptionPlan[] = subscriptionPlans,
): InstitutionPlatformState {
  if (status !== "active" && status !== "suspended") throw new Error("Unsupported institution status.");
  return {
    ...state,
    status,
    // Suspension stops commercial collection; it never changes the relationship or the plan.
    subscription: {
      ...state.subscription,
      status: status === "suspended" ? "suspended" : state.subscription.billingEnabled ? "active" : "not_applicable",
    },
    billingState: status === "suspended"
      ? { ...state.billingState, status: "suspended" }
      // Reactivation clears a billing suspension that was caused by the institution suspension itself.
      : deriveBillingState(
        planOrDefault(state.planTier, plans),
        { ...state.billingState, status: state.billingState.status === "suspended" ? "current" : state.billingState.status },
        now,
      ),
    platformUpdatedAt: now,
    platformUpdatedBy: actorUid,
  };
}

export function updateSecurityState(
  state: InstitutionPlatformState,
  level: InstitutionSecurityLevel,
  reason: string,
  actorUid: string,
  now = new Date().toISOString(),
): InstitutionPlatformState {
  if (!["standard", "elevated", "restricted"].includes(level)) throw new Error("Unsupported security level.");
  if (!reason.trim()) throw new Error("A security state change requires a reason.");
  const securityState: InstitutionSecurityState = { level, reason: reason.trim(), updatedAt: now, updatedBy: actorUid };
  return { ...state, securityState, platformUpdatedAt: now, platformUpdatedBy: actorUid };
}

export function updatePolicies(
  state: InstitutionPlatformState,
  policies: unknown,
  actorUid: string,
  now = new Date().toISOString(),
): InstitutionPlatformState {
  const allowedKeys = Object.keys(defaultInstitutionPolicies) as (keyof InstitutionPolicies)[];
  if (!policies || typeof policies !== "object" || Array.isArray(policies)) {
    throw new Error("POLICY_INVALID");
  }
  const updates: Partial<InstitutionPolicies> = {};
  for (const [key, value] of Object.entries(policies)) {
    if (!allowedKeys.includes(key as keyof InstitutionPolicies) || typeof value !== "boolean") {
      throw new Error("POLICY_INVALID");
    }
    updates[key as keyof InstitutionPolicies] = value;
  }
  return { ...state, policies: { ...state.policies, ...updates }, platformUpdatedAt: now, platformUpdatedBy: actorUid };
}

/** Billing overrides are bounded by the plan definition instead of hard-coded exceptions. */
export function updateBillingOverride(
  state: InstitutionPlatformState,
  input: { billingEnabled?: boolean; invoicesEnabled?: boolean; note?: string },
  actorUid: string,
  now = new Date().toISOString(),
  plans: SubscriptionPlan[] = subscriptionPlans,
): InstitutionPlatformState {
  const plan = requirePlan(state.planTier, plans);
  if (input.billingEnabled === true && !plan.billingEnabled) {
    throw new Error(`${plan.name} plans do not allow billing. Migrate the institution to a commercial plan instead.`);
  }
  const billingEnabled = input.billingEnabled ?? state.subscription.billingEnabled;
  const requestedInvoices = input.invoicesEnabled ?? state.subscription.invoicesEnabled;
  if (input.invoicesEnabled === true && !billingEnabled) throw new Error("Invoices cannot be enabled while billing is disabled.");
  // Invoices can never outlive billing: disabling billing disables invoicing too.
  const invoicesEnabled = billingEnabled ? requestedInvoices : false;
  const status = billingEnabled
    ? state.status === "suspended" ? "suspended" : state.billingState.status === "not_applicable" ? "current" : state.billingState.status
    : "not_applicable";
  return {
    ...state,
    subscription: { ...state.subscription, billingEnabled, invoicesEnabled },
    billingState: {
      ...state.billingState,
      status,
      invoicesEnabled,
      nextInvoiceAt: billingEnabled ? state.billingState.nextInvoiceAt ?? nextInvoiceDue(now) : null,
      note: input.note ?? state.billingState.note,
    },
    platformUpdatedAt: now,
    platformUpdatedBy: actorUid,
  };
}

export function evaluateInstitutionHealth(input: {
  state: InstitutionPlatformState;
  usage: InstitutionUsageSnapshot | null;
  violations: LimitViolation[];
  monitoringIncomplete: boolean;
  now?: string;
}): InstitutionHealth {
  const now = input.now ?? new Date().toISOString();
  const reasons: string[] = [];
  let level: InstitutionHealthLevel = "healthy";
  if (input.state.status === "suspended") {
    reasons.push("Institution is suspended by platform administration.");
    level = "critical";
  }
  if (input.state.securityState.level === "restricted") {
    reasons.push(`Security state is restricted: ${input.state.securityState.reason}`);
    if (level !== "critical") level = "attention";
  } else if (input.state.securityState.level === "elevated") {
    reasons.push(`Security state is elevated: ${input.state.securityState.reason}`);
    if (level !== "critical") level = "attention";
  }
  if (input.violations.length) {
    reasons.push(...input.violations.map((violation) => violation.message));
    if (level !== "critical") level = "attention";
  }
  if (!input.usage) {
    reasons.push("Live usage could not be measured for this institution.");
    if (level === "healthy") level = "unknown";
  }
  if (input.monitoringIncomplete) reasons.push("Some monitoring signals are unavailable and were not estimated.");
  return { level, reasons: reasons.length ? reasons : ["No platform issues detected."], evaluatedAt: now };
}

/* -------------------------------------------------------------------------- */
/* Platform monitoring (unmeasurable signals are reported, never fabricated)   */
/* -------------------------------------------------------------------------- */

/** Domains Firestore aggregates can measure for an institution today. */
export function buildMonitoringObservations(input: {
  usage: InstitutionUsageSnapshot | null;
  signals: MonitoringSignal[];
}): MonitoringObservation[] {
  const latest = new Map<MonitoringDomain, MonitoringSignal>();
  for (const signal of [...input.signals].sort((a, b) => (a.capturedAt === b.capturedAt ? a.signalId.localeCompare(b.signalId) : a.capturedAt.localeCompare(b.capturedAt)))) {
    latest.set(signal.domain, signal);
  }
  const fromUsage = (
    domain: MonitoringDomain,
    value: number | null,
    unit: string,
    evidence: string[],
    reason: string,
    sources: string[],
  ): MonitoringObservation => {
    const unavailable = sources.some((source) => input.usage?.unavailable.includes(source));
    if (input.usage && value !== null && !unavailable) {
      return { domain, availability: "available", value, unit, source: "firestore-aggregate", reason, evidence };
    }
    return {
      domain, availability: "unavailable", value: null, unit: null, source: "unavailable",
      reason: unavailable ? `Required usage aggregate unavailable: ${sources.join(", ")}.` : "Institution usage aggregates are unavailable.",
      evidence: [],
    };
  };
  const fromSignals = (domain: MonitoringDomain, reason: string): MonitoringObservation => {
    const signal = latest.get(domain);
    if (signal) {
      return {
        domain,
        availability: "available",
        value: signal.value,
        unit: signal.unit,
        source: signal.source === "operator-entry" ? "operator-entry" : "ingested-signal",
        reason: signal.note || reason,
        evidence: [signal.signalId, signal.source],
      };
    }
    return { domain, availability: "unavailable", value: null, unit: null, source: "unavailable", reason, evidence: [] };
  };
  const usage = input.usage;
  return [
    fromUsage("activity", usage?.activeUsers ?? null, "active users", ["users.status", "users.lastActive"], "Active users recorded in the institution workspace.", ["users"]),
    fromSignals("performance", "Runtime latency is not recorded in Firestore. Ingest a platform-agent signal to report it."),
    fromUsage("errors", usage?.integrationExceptions ?? null, "open exceptions", ["integrationExceptions.status"], "Open integration and financial exceptions.", ["integrationExceptions"]),
    fromUsage("security", usage?.securityEvents ?? null, "security events", ["securityEvents.type"], "Institution security events recorded.", ["securityEvents"]),
    fromUsage("storage", usage?.storageBytes ?? null, "bytes", ["documents.size", "documents.blobPath"], "Sum of tenant document sizes.", ["documents.size"]),
    fromSignals("reads", "Daily document reads are only available from Google Cloud telemetry. Ingest a platform-agent signal to report them."),
    fromSignals("writes", "Daily document writes are only available from Google Cloud telemetry. Ingest a platform-agent signal to report them."),
    fromSignals("listeners", "Firestore listener counts are only available from Google Cloud telemetry. Ingest a platform-agent signal to report them."),
    fromSignals("bandwidth", "Bandwidth is only available from Google Cloud telemetry. Ingest a platform-agent signal to report it."),
    fromSignals("functions", "Cloud Functions execution metrics are only available from Google Cloud telemetry. Ingest a platform-agent signal to report them."),
    fromSignals("queues", "Queue depth is only available from the scheduling runtime. Ingest a platform-agent signal to report it."),
    fromUsage("imports", usage?.imports ?? null, "import batches", ["bulkImportBatches.status"], "Bulk import batches recorded for the institution.", ["bulkImportBatches"]),
    fromUsage("payments", usage?.payments ?? null, "payments", ["payments.status"], "Tenant payment records recorded by the institution.", ["payments"]),
    fromUsage("notifications", usage?.notifications ?? null, "notifications", ["notifications.state"], "Institution notification records.", ["notifications"]),
  ];
}

export function summarizeMonitoring(observations: MonitoringObservation[], now = new Date().toISOString()): MonitoringSummary {
  const unavailable = observations.filter((observation) => observation.availability === "unavailable").length;
  return {
    observations,
    available: observations.length - unavailable,
    unavailable,
    complete: unavailable === 0,
    evaluatedAt: now,
  };
}

export function monitoringSnapshot(input: { usage: InstitutionUsageSnapshot | null; signals: MonitoringSignal[]; now?: string }): MonitoringSummary {
  return summarizeMonitoring(buildMonitoringObservations({ usage: input.usage, signals: input.signals }), input.now);
}

/* -------------------------------------------------------------------------- */
/* Support access: explicit, scoped, time limited, auditable, never silent     */
/* -------------------------------------------------------------------------- */

export function createSupportGrant(input: {
  institutionId: string;
  operator: { uid: string; platformRole: PlatformRole };
  scopes: unknown;
  reason: unknown;
  durationMinutes?: number;
  now?: string;
}): SupportAccessGrant {
  const institutionId = String(input.institutionId ?? "").trim();
  if (!institutionId) throw new Error("A support grant requires an institution.");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 8) throw new Error("A support grant requires an explicit reason.");
  const requested = Array.isArray(input.scopes) ? input.scopes.filter((value): value is string => typeof value === "string") : [];
  const scopes = [...new Set(requested.filter((scope): scope is SupportScope => (supportScopes as readonly string[]).includes(scope)))];
  if (!scopes.length) throw new Error("A support grant requires at least one authorized scope.");
  const requestedMinutes = Number.isFinite(input.durationMinutes) ? Number(input.durationMinutes) : SUPPORT_DEFAULT_DURATION_MINUTES;
  if (requestedMinutes < 1 || requestedMinutes > SUPPORT_MAX_DURATION_MINUTES) {
    throw new Error(`Support access must be between 1 and ${SUPPORT_MAX_DURATION_MINUTES} minutes.`);
  }
  const now = input.now ?? new Date().toISOString();
  const expiresAt = new Date(new Date(now).getTime() + requestedMinutes * 60_000).toISOString();
  return {
    grantId: deterministicId("sgrant", { institutionId, operatorUid: input.operator.uid, scopes, reason, now }),
    institutionId,
    operatorUid: input.operator.uid,
    operatorRole: input.operator.platformRole,
    scopes,
    reason,
    readOnly: true,
    status: "active",
    grantedAt: now,
    expiresAt,
  };
}

export function isSupportGrantActive(grant: SupportAccessGrant, now = new Date().toISOString(), institutionId?: string) {
  if (grant.status !== "active") return false;
  if (institutionId && grant.institutionId !== institutionId) return false;
  return new Date(grant.expiresAt).getTime() > new Date(now).getTime();
}

export function expireSupportGrant(grant: SupportAccessGrant, now = new Date().toISOString()): SupportAccessGrant {
  if (grant.status === "active" && !isSupportGrantActive(grant, now)) return { ...grant, status: "expired" };
  return grant;
}

export function revokeSupportGrant(
  grant: SupportAccessGrant,
  actorUid: string,
  reason: string,
  now = new Date().toISOString(),
): SupportAccessGrant {
  if (!reason.trim()) throw new Error("Revoking support access requires a reason.");
  return { ...grant, status: "revoked", revokedAt: now, revokedBy: actorUid, revokedReason: reason.trim() };
}

export function scopeAllows(grant: SupportAccessGrant, scope: SupportScope, now = new Date().toISOString()) {
  return isSupportGrantActive(grant, now) && grant.scopes.includes(scope);
}

/** Support access always produces a visible institution security event. */
export function supportSecurityEvent(grant: SupportAccessGrant) {
  return {
    type: "sensitive_action" as const,
    source: "platform.support-access",
    visibleToInstitution: true,
    details: {
      grantId: grant.grantId,
      scopes: grant.scopes,
      reason: grant.reason,
      expiresAt: grant.expiresAt,
      readOnly: grant.readOnly,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Platform authorization (separate from institution roles)                    */
/* -------------------------------------------------------------------------- */

const roleCapabilities: Record<PlatformRole, PlatformCapability[]> = {
  "Platform Owner": [...platformCapabilities],
  "Platform Administrator": platformCapabilities.filter((capability) => capability !== "operators.manage"),
  "Platform Support": ["institutions.view", "monitoring.view", "audit.view"],
  "Platform Analyst": ["institutions.view", "monitoring.view", "audit.view"],
};

export function capabilitiesFor(role: PlatformRole): PlatformCapability[] {
  return [...(roleCapabilities[role] ?? [])];
}

export function canPlatform(role: PlatformRole, capability: PlatformCapability) {
  return capabilitiesFor(role).includes(capability);
}

export function requirePlatformCapability(role: PlatformRole, capability: PlatformCapability) {
  if (!canPlatform(role, capability)) throw new Error("FORBIDDEN");
}

export function isActivePlatformOperator(operator: PlatformOperator | null | undefined): operator is PlatformOperator {
  return Boolean(operator && operator.status === "active" && operator.uid);
}

/** A support operator only reaches institutions covered by an active, explicit grant. */
export function requiresSupportGrant(role: PlatformRole) {
  return role === "Platform Support";
}

export function canAccessInstitution(input: {
  operator: PlatformOperator;
  institutionId: string;
  grants: SupportAccessGrant[];
  now?: string;
}) {
  if (!canPlatform(input.operator.platformRole, "institutions.view")) return false;
  if (!requiresSupportGrant(input.operator.platformRole)) return true;
  return input.grants.some((grant) => grant.operatorUid === input.operator.uid
    && isSupportGrantActive(grant, input.now, input.institutionId)
    && grant.scopes.includes("institution.overview"));
}

/** First-run only provisioning: the allow-list is ignored once any operator exists. */
export function bootstrapEmails(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function canBootstrapOperator(input: {
  email: string | null | undefined;
  emailVerified: boolean;
  activeOperatorCount: number;
  allowlist: string[];
}) {
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!email) return { allowed: false, reason: "A verified operator email is required." };
  if (!input.emailVerified) return { allowed: false, reason: "The operator email must be verified before bootstrap." };
  if (!input.allowlist.includes(email)) return { allowed: false, reason: "The email is not authorised for platform bootstrap." };
  if (input.activeOperatorCount > 0) return { allowed: false, reason: "Platform bootstrap is closed: operators already exist." };
  return { allowed: true, reason: "First-run platform bootstrap authorised." };
}

/* -------------------------------------------------------------------------- */
/* Reading stored platform state (legacy-safe)                                */
/* -------------------------------------------------------------------------- */

export function readPlatformState(
  institutionId: string,
  data: Record<string, unknown>,
  context: EntitlementContext,
  now = new Date().toISOString(),
): InstitutionPlatformState {
  const plan = planOrDefault(data.planTier, context.plans);
  const actorUid = typeof data.platformUpdatedBy === "string" && data.platformUpdatedBy ? data.platformUpdatedBy : "platform";
  const storedSubscription = data.subscription as InstitutionSubscription | undefined;
  const storedEntitlement = data.entitlement as InstitutionEntitlement | undefined;
  const effectiveEntitlement = resolveEntitlement(plan, storedEntitlement?.overrides ?? {}, actorUid, now, context);
  const storedSecurity = data.securityState as InstitutionSecurityState | undefined;
  const relationship = typeof data.relationship === "string"
    && (institutionRelationships as readonly string[]).includes(data.relationship)
    ? (data.relationship as InstitutionPlatformState["relationship"])
    : defaultInstitutionRelationship;
  const storedPolicies = (data.policies ?? {}) as Partial<InstitutionPolicies>;
  return {
    institutionId,
    status: data.status === "suspended" ? "suspended" : "active",
    relationship,
    planTier: plan.planId,
    subscription: storedSubscription?.planId ? { ...storedSubscription, planId: plan.planId } : deriveSubscription(plan, undefined, actorUid, now),
    entitlement: {
      ...effectiveEntitlement,
      updatedAt: storedEntitlement?.updatedAt ?? effectiveEntitlement.updatedAt,
      updatedBy: storedEntitlement?.updatedBy ?? actorUid,
    },
    policies: { ...defaultInstitutionPolicies, ...storedPolicies },
    securityState: storedSecurity?.level
      ? storedSecurity
      : { level: "standard", reason: "No platform security state recorded.", updatedAt: now, updatedBy: actorUid },
    billingState: (data.billingState as InstitutionBillingState | undefined) ?? deriveBillingState(plan, undefined, now),
    platformUpdatedAt: typeof data.platformUpdatedAt === "string" ? data.platformUpdatedAt : undefined,
    platformUpdatedBy: typeof data.platformUpdatedBy === "string" ? data.platformUpdatedBy : undefined,
  };
}

export function institutionSummary(
  state: InstitutionPlatformState,
  institution: Record<string, unknown>,
  plans: SubscriptionPlan[] = subscriptionPlans,
): PlatformInstitutionSummary {
  const plan = requirePlan(state.planTier, plans);
  return {
    institutionId: state.institutionId,
    name: typeof institution.name === "string" ? institution.name : state.institutionId,
    country: typeof institution.country === "string" ? institution.country : "",
    status: state.status,
    relationship: state.relationship,
    planId: plan.planId,
    planName: plan.name,
    planCategory: plan.category,
    billingEnabled: state.subscription.billingEnabled,
    securityLevel: state.securityState.level,
    modules: state.entitlement.modules,
    updatedAt: state.platformUpdatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Institution administration view                                            */
/* -------------------------------------------------------------------------- */

/** Fields that must never appear in a platform administration view. */
export const forbiddenPlatformViewKeys = [
  "employees", "patients", "tasks", "messages", "documents", "clinicalRecords",
  "financialRecords", "billingReferences", "securityEvents", "auditEvents", "payloads",
];

export function assertPlatformSafeView(view: Record<string, unknown>) {
  for (const key of Object.keys(view)) {
    if (forbiddenPlatformViewKeys.includes(key)) throw new Error(`Platform views cannot expose ${key}.`);
  }
  const usage = view.usage as Record<string, unknown> | null;
  if (usage) {
    for (const [key, value] of Object.entries(usage)) {
      const scalar = value === null
        || ["string", "number", "boolean"].includes(typeof value)
        || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
      if (!scalar) throw new Error(`Platform usage value ${key} must be an aggregate, not tenant records.`);
    }
  }
  return view;
}

export function buildInstitutionAdministrationView(input: {
  state: InstitutionPlatformState;
  institution: Record<string, unknown>;
  usage: InstitutionUsageSnapshot | null;
  signals?: MonitoringSignal[];
  grants?: SupportAccessGrant[];
  plans?: SubscriptionPlan[];
  now?: string;
}): PlatformInstitutionView {
  const now = input.now ?? new Date().toISOString();
  const plans = input.plans ?? subscriptionPlans;
  const plan = requirePlan(input.state.planTier, plans);
  const limitViolations = evaluateLimitViolations(input.state.entitlement.limits, input.usage);
  const monitoring = monitoringSnapshot({ usage: input.usage, signals: input.signals ?? [], now });
  const health = evaluateInstitutionHealth({
    state: input.state,
    usage: input.usage,
    violations: limitViolations,
    monitoringIncomplete: !monitoring.complete,
    now,
  });
  const summary = institutionSummary(input.state, input.institution, plans);
  const view: PlatformInstitutionView = {
    ...summary,
    plan: {
      planId: plan.planId,
      name: plan.name,
      category: plan.category,
      billingEnabled: plan.billingEnabled,
      invoicesEnabled: plan.invoicesEnabled,
      premiumFeatures: plan.premiumFeatures,
      moduleScope: plan.moduleScope,
      migrationTargets: [...plan.migrationTargets],
      visibleToCustomers: plan.visibleToCustomers,
    },
    subscription: input.state.subscription,
    entitlement: input.state.entitlement,
    policies: input.state.policies,
    securityState: input.state.securityState,
    billingState: input.state.billingState,
    health,
    usage: input.usage,
    monitoring,
    limitViolations,
    supportGrants: (input.grants ?? [])
      .filter((grant) => grant.institutionId === input.state.institutionId)
      .map((grant) => expireSupportGrant(grant, now))
      .sort((a, b) => b.grantedAt.localeCompare(a.grantedAt)),
    createdAt: typeof input.institution.createdAt === "string" ? input.institution.createdAt : undefined,
  };
  return assertPlatformSafeView(view as unknown as Record<string, unknown>) as unknown as PlatformInstitutionView;
}

/** Platform Support only sees what an explicit grant allows; everything else is withheld. */
export function applySupportScopeRedaction(
  view: PlatformInstitutionView,
  grant: SupportAccessGrant,
  now = new Date().toISOString(),
): SupportScopedView {
  if (!isSupportGrantActive(grant, now, view.institutionId) || !grant.scopes.includes("institution.overview")) {
    throw new Error("An active support grant for this institution is required.");
  }
  const scopes = grant.scopes;
  const has = (scope: SupportScope) => scopes.includes(scope);
  const withUsage = has("usage.view");
  const withBilling = has("billing.view");
  const withSecurity = has("security.view");
  const withheld = (["usage.view", "billing.view", "security.view", "audit.view"] as SupportScope[]).filter((scope) => !has(scope));
  const visibleMonitoringObservations = withUsage
    ? view.monitoring.observations.filter((observation) => withSecurity || observation.domain !== "security")
    : [];
  const monitoring = !withUsage
    ? summarizeMonitoring([], now)
    : withSecurity
      ? view.monitoring
      : {
        ...view.monitoring,
        observations: visibleMonitoringObservations,
        available: visibleMonitoringObservations.filter((observation) => observation.availability === "available").length,
        unavailable: visibleMonitoringObservations.filter((observation) => observation.availability === "unavailable").length,
        complete: visibleMonitoringObservations.every((observation) => observation.availability === "available"),
      };
  const {
    planId, planName, planCategory, billingEnabled, modules, plan, subscription, entitlement,
    securityLevel, networkTrustState, policies, securityState, billingState, health, ...overview
  } = view;
  return {
    view: {
      ...overview,
      ...(withBilling ? { planId, planName, planCategory, billingEnabled, modules, plan, subscription, entitlement } : {}),
      ...(withSecurity ? { securityLevel, networkTrustState, policies, securityState, health } : {}),
      usage: withUsage ? view.usage : null,
      monitoring,
      limitViolations: withUsage ? view.limitViolations : [],
      ...(withBilling ? { billingState } : {}),
      supportGrants: has("audit.view") ? view.supportGrants : [],
    },
    grantedScopes: scopes,
    withheldScopes: withheld,
  };
}

export function platformDashboardStats(institutions: PlatformInstitutionSummary[]) {
  const byRelationship: Record<string, number> = {};
  const byPlan: Record<string, number> = {};
  const byPlanCategory: Record<string, number> = {};
  const byHealthLevel: Record<string, number> = {};
  let suspended = 0;
  let billingEnabled = 0;
  for (const institution of institutions) {
    byRelationship[institution.relationship] = (byRelationship[institution.relationship] ?? 0) + 1;
    byPlan[institution.planId] = (byPlan[institution.planId] ?? 0) + 1;
    byPlanCategory[institution.planCategory] = (byPlanCategory[institution.planCategory] ?? 0) + 1;
    byHealthLevel[institution.securityLevel] = (byHealthLevel[institution.securityLevel] ?? 0) + 1;
    if (institution.status === "suspended") suspended += 1;
    if (institution.billingEnabled) billingEnabled += 1;
  }
  return {
    total: institutions.length,
    suspended,
    billingEnabled,
    billingExempt: institutions.length - billingEnabled,
    byRelationship,
    byPlan,
    byPlanCategory,
    bySecurityLevel: byHealthLevel,
  };
}
