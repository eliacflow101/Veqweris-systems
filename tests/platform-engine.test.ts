import assert from "node:assert/strict";
import { navigationConfig } from "../lib/navigation";
import { createAuditEvent } from "../lib/governance";
import {
  applySupportScopeRedaction, assertPlatformSafeView, assignPlan, assignRelationship,
  bootstrapEmails, buildInstitutionAdministrationView, canAccessInstitution, canBootstrapOperator,
  canPlatform, canonicalPlanId, capabilitiesFor, createSupportGrant, defaultPlanForNewInstitution,
  defaultPlatformState, evaluateInstitutionHealth, evaluateLimitViolations, getPlan,
  isSupportGrantActive, listPlans, monitoringSnapshot, platformDashboardStats, platformModuleCatalogue,
  readPlatformState, requirePlan, requirePlatformCapability, resolveEntitlement, revokeSupportGrant, scopeAllows,
  subscriptionPlans, supportSecurityEvent, tenantModuleCatalogue, updateBillingOverride,
  updateEntitlementOverrides, updateInstitutionStatus, updatePolicies, updateSecurityState,
  validateFeatureSelection, validateModuleSelection,
} from "../lib/platform";
import type { PlatformInstitutionSummary, PlatformRole, InstitutionUsageSnapshot } from "../lib/platform";
import { planFeatureKeys } from "../lib/platform/models";

const now = "2026-03-01T00:00:00.000Z";
const tenantModules = tenantModuleCatalogue(navigationConfig);
const platformModules = platformModuleCatalogue(navigationConfig);
const context = { tenantModules };

/* -------------------------------- plan registry -------------------------------- */

assert.equal(subscriptionPlans.length, 6, "six subscription plans are defined");
assert.deepEqual(
  subscriptionPlans.map((plan) => plan.planId).sort(),
  ["basic", "developer", "enterprise", "internal", "partner", "professional"],
);
assert.equal(getPlan("internal")?.billingEnabled, false);
assert.equal(getPlan("partner")?.billingEnabled, false);
assert.equal(getPlan("basic")?.billingEnabled, true);
assert.equal(getPlan("internal")?.premiumFeatures, true, "Internal allows premium features");
assert.equal(getPlan("partner")?.premiumFeatures, true, "Partner allows premium features");
assert.equal(getPlan("internal")?.invoicesEnabled, false, "Internal issues no invoices");
assert.equal(getPlan("partner")?.invoicesEnabled, false, "Partner issues no invoices");
assert.ok(getPlan("partner")?.migrationTargets.includes("professional"), "Partner migrates to a commercial plan");
assert.equal(canonicalPlanId("trial"), "basic", "legacy trial plan resolves to the default commercial plan");
assert.equal(canonicalPlanId("unknown"), "basic");
assert.equal(defaultPlanForNewInstitution().planId, "basic", "registration default is a commercial plan");

const customerPlans = listPlans("customer");
assert.equal(customerPlans.length, 3, "commercial users only see commercial plans");
assert.ok(customerPlans.every((plan) => plan.category === "commercial"));
assert.ok(!customerPlans.some((plan) => plan.planId === "internal" || plan.planId === "partner"));
assert.equal(listPlans("platform").length, 6, "platform operators see every plan");

/* ------------------------------ module catalogue ------------------------------- */

assert.ok(platformModules.some((entry) => entry.moduleId === "platform-admin"), "platform admin module is platform-only");
assert.ok(!tenantModules.some((entry) => entry.moduleId === "platform-admin"), "institutions never receive the platform module");
assert.ok(!tenantModules.some((entry) => entry.moduleId === "finance"), "unbuilt future modules are not entitlement modules");
assert.ok(tenantModules.some((entry) => entry.moduleId === "dashboard"));
assert.ok(tenantModules.some((entry) => entry.moduleId === "healthcare"));

/* --------------------------- default registration state ------------------------ */

const basicState = defaultPlatformState("institution-1", "platform-bootstrap", now, context);
assert.equal(basicState.planTier, "basic");
assert.equal(basicState.relationship, "Customer", "registration defaults to the Customer relationship");
assert.equal(basicState.status, "active");
assert.equal(basicState.subscription.billingEnabled, true);
assert.equal(basicState.billingState.status, "current");
assert.ok(basicState.entitlement.modules.includes("dashboard"));
assert.ok(!basicState.entitlement.modules.includes("analytics"), "Basic excludes the intelligence modules");
assert.equal(basicState.entitlement.features.length, 0, "Basic has no premium features");
assert.equal(basicState.entitlement.limits.maxUsers, 25);
assert.deepEqual(basicState.entitlement.features, [], "Basic does not inherit undeclared features");

const professionalAssigned = assignPlan(basicState, "professional", "platform-owner", now, context);
assert.deepEqual(
  [...professionalAssigned.entitlement.features].sort(),
  ["data-export", "document-automation", "external-integrations", "institutional-network"],
  "Professional receives only explicitly declared features",
);
const enterpriseAssigned = assignPlan(basicState, "enterprise", "platform-owner", now, context);
assert.equal(enterpriseAssigned.entitlement.features.length, planFeatureKeys.length, "Enterprise receives its declared complete feature set");
const explicitFeatureGrant = updateEntitlementOverrides(
  basicState.entitlement, { features: ["priority-support", "unknown-feature" as never] },
  "platform-owner", now, context,
);
assert.deepEqual(explicitFeatureGrant.features, ["priority-support"], "unknown feature keys are denied");

/* -------------------- plan assignment and relationship independence ------------ */

const internalAssignmentContext = {
  ...context,
  plans: subscriptionPlans.map((plan) => plan.planId === "basic"
    ? { ...plan, migrationTargets: [...plan.migrationTargets, "internal" as const] }
    : plan),
};
const internalAssigned = assignPlan(basicState, "internal", "platform-owner", now, internalAssignmentContext);
assert.equal(internalAssigned.planTier, "internal");
assert.equal(internalAssigned.relationship, "Customer", "a plan change never rewrites the relationship");
assert.equal(internalAssigned.subscription.billingEnabled, false);
assert.equal(internalAssigned.subscription.invoicesEnabled, false);
assert.equal(internalAssigned.subscription.premiumFeatures, true);
assert.equal(internalAssigned.subscription.status, "not_applicable");
assert.equal(internalAssigned.billingState.status, "not_applicable");
assert.equal(internalAssigned.subscription.migratedFrom, "basic", "plan migrations are recorded");
assert.equal(internalAssigned.subscription.renewalPolicy, "none");
assert.ok(internalAssigned.entitlement.modules.includes("analytics"), "Internal unlocks every module");
assert.equal(internalAssigned.entitlement.features.length, planFeatureKeys.length, "Internal unlocks every registered feature");

const partnerAssigned = assignPlan(internalAssigned, "partner", "platform-owner", now, context);
assert.equal(partnerAssigned.subscription.billingEnabled, false);
assert.equal(partnerAssigned.billingState.status, "not_applicable");
assert.equal(partnerAssigned.relationship, "Customer");

const partnerWithRelationship = assignRelationship(partnerAssigned, "Strategic Partner", "platform-owner", now);
assert.equal(partnerWithRelationship.relationship, "Strategic Partner");
assert.equal(partnerWithRelationship.planTier, "partner", "a relationship change never rewrites the plan");
assert.equal(partnerWithRelationship.subscription.planId, "partner");
assert.throws(() => assignRelationship(basicState, "Best Friend", "platform-owner", now), /relationship/i);

const migratedCommercial = assignPlan(partnerWithRelationship, "professional", "platform-owner", now, context);
assert.equal(migratedCommercial.relationship, "Strategic Partner", "partner migration keeps the relationship");
assert.equal(migratedCommercial.subscription.billingEnabled, true);
assert.equal(migratedCommercial.subscription.migratedFrom, "partner");
assert.ok(migratedCommercial.entitlement.modules.includes("analytics"));
assert.ok(migratedCommercial.entitlement.features.includes("data-export"));
assert.equal(migratedCommercial.entitlement.limits.maxUsers, 150);
assert.throws(() => assignPlan(basicState, "partner", "platform-owner", now, { ...context, plans: subscriptionPlans }), /PLAN_MIGRATION_NOT_ALLOWED/);
assert.throws(() => assignPlan(basicState, "enterprise", "platform-owner", now, {
  ...context,
  plans: subscriptionPlans.map((plan) => plan.planId === "enterprise" ? { ...plan, status: "deprecated" } : plan),
}), /PLAN_INACTIVE/);

/* --------------------------- feature control without code ---------------------- */

const legacy = readPlatformState("institution-legacy", { planTier: "trial", status: "active", name: "Legacy" }, context, now);
assert.equal(legacy.planTier, "basic", "legacy institutions resolve to a current plan");
assert.equal(legacy.relationship, "Customer");
assert.equal(legacy.securityState.level, "standard");

const granted = updateEntitlementOverrides(legacy.entitlement, { modules: ["analytics"], features: ["data-export"], limits: { maxUsers: 99 } }, "platform-admin", now, context);
assert.ok(granted.modules.includes("analytics"), "a platform grant enables a module without a code change");
assert.ok(granted.modules.includes("dashboard"), "plan modules remain granted alongside the override");
assert.deepEqual(granted.features, ["data-export"]);
assert.equal(granted.limits.maxUsers, 99);
assert.equal(granted.limits.maxDepartments, 8, "unrelated limits still come from the plan");

const moduleSelection = validateModuleSelection(["analytics", "not-a-module"], tenantModules);
assert.deepEqual(moduleSelection.valid, ["analytics"]);
assert.deepEqual(moduleSelection.unknown, ["not-a-module"]);
const featureSelection = validateFeatureSelection(["data-export", "warp-drive"]);
assert.deepEqual(featureSelection.valid, ["data-export"]);
assert.deepEqual(featureSelection.unknown, ["warp-drive"]);
assert.throws(() => assignPlan(basicState, "galactic", "platform-owner", now, context), /unknown subscription plan/i);

/* --------------------------------- plan limits -------------------------------- */

const oversizedUsage: InstitutionUsageSnapshot = {
  institutionId: "institution-1", users: 30, activeUsers: 20, departments: 12, documents: 4,
  storageBytes: 3 * 1024 * 1024 * 1024, tasks: 5, notifications: 9000, payments: 2,
  auditEvents: 1, securityEvents: 3, imports: 1, integrationExceptions: 0, integrations: 4,
  generatedAt: now, unavailable: [],
};
const violations = evaluateLimitViolations(basicState.entitlement.limits, oversizedUsage);
assert.deepEqual(
  violations.map((violation) => violation.limit).sort(),
  ["maxDepartments", "maxIntegrationEndpoints", "maxMonthlyNotifications", "maxStorageMb", "maxUsers"],
);
assert.equal(evaluateLimitViolations(getPlan("enterprise")!.limits, oversizedUsage).length, 0, "unlimited plans report no violations");
assert.equal(evaluateLimitViolations(basicState.entitlement.limits, {
  ...oversizedUsage, users: null, departments: null, storageBytes: null, notifications: null, integrations: null,
}).length, 0, "unavailable metrics are not reported as zero or as measured violations");

/* ------------------------------- billing control ------------------------------ */

assert.throws(() => updateBillingOverride(partnerAssigned, { billingEnabled: true }, "platform-admin", now), /commercial plan/i);
assert.throws(() => updateBillingOverride(internalAssigned, { invoicesEnabled: true }, "platform-admin", now), /Invoices cannot be enabled/);
const billingOff = updateBillingOverride(basicState, { billingEnabled: false }, "platform-admin", now);
assert.equal(billingOff.subscription.billingEnabled, false);
assert.equal(billingOff.billingState.status, "not_applicable");
assert.equal(billingOff.billingState.nextInvoiceAt, null);

const suspendedInstitution = updateInstitutionStatus(basicState, "suspended", "platform-admin", now);
assert.equal(suspendedInstitution.status, "suspended");
assert.equal(suspendedInstitution.billingState.status, "suspended");
assert.equal(suspendedInstitution.planTier, "basic", "suspension never changes the plan");
const reactivated = updateInstitutionStatus(suspendedInstitution, "active", "platform-admin", now);
assert.equal(reactivated.status, "active");
assert.equal(reactivated.billingState.status, "current");

const secured = updateSecurityState(basicState, "restricted", "Credential stuffing detected", "platform-admin", now);
assert.equal(secured.securityState.level, "restricted");
assert.throws(() => updateSecurityState(basicState, "restricted", "   ", "platform-admin", now), /reason/i);
const policied = updatePolicies(basicState, { allowNetworkParticipation: true }, "platform-admin", now);
assert.equal(policied.policies.allowNetworkParticipation, true);
assert.equal(policied.policies.requireSensitiveReauth, true, "unset policies keep secure defaults");
assert.throws(() => updatePolicies(basicState, { supportAccessEnabled: "false" }, "platform-admin", now), /POLICY_INVALID/);
assert.throws(() => updatePolicies(basicState, { unexpectedPolicy: true }, "platform-admin", now), /POLICY_INVALID/);

/* ------------------------- monitoring and health honesty ---------------------- */

const blindMonitoring = monitoringSnapshot({ usage: null, signals: [], now });
assert.equal(blindMonitoring.complete, false, "unmeasured signals are never reported as complete");
assert.ok(blindMonitoring.observations.some((observation) => observation.reason.includes("telemetry")), "telemetry gaps are explained");
assert.ok(blindMonitoring.observations.every((observation) => observation.availability === "unavailable"));

const liveMonitoring = monitoringSnapshot({ usage: oversizedUsage, signals: [], now });
assert.equal(liveMonitoring.observations.find((observation) => observation.domain === "activity")?.availability, "available");
assert.equal(liveMonitoring.observations.find((observation) => observation.domain === "storage")?.value, oversizedUsage.storageBytes);
assert.equal(liveMonitoring.observations.find((observation) => observation.domain === "reads")?.availability, "unavailable");
assert.equal(liveMonitoring.available + liveMonitoring.unavailable, liveMonitoring.observations.length);
const partiallyUnavailable = monitoringSnapshot({
  usage: { ...oversizedUsage, unavailable: ["users", "payments"] }, signals: [], now,
});
assert.equal(partiallyUnavailable.observations.find((observation) => observation.domain === "activity")?.availability, "unavailable");
assert.equal(partiallyUnavailable.observations.find((observation) => observation.domain === "payments")?.availability, "unavailable");
assert.equal(partiallyUnavailable.observations.find((observation) => observation.domain === "security")?.availability, "available");

const ingested = monitoringSnapshot({
  usage: oversizedUsage,
  signals: [
    {
      signalId: "signal-1", institutionId: "institution-1", domain: "reads", metric: "document_reads",
      value: 512_000, unit: "reads/day", source: "platform-agent", note: "Cloud monitoring export",
      capturedAt: now, recordedBy: "platform-agent",
    },
    {
      signalId: "signal-2", institutionId: "institution-1", domain: "bandwidth", metric: "monthly_bandwidth",
      value: 18, unit: "GB", source: "operator-entry", note: "Monthly provider statement",
      capturedAt: now, recordedBy: "platform-owner",
    },
  ],
  now,
});
const reads = ingested.observations.find((observation) => observation.domain === "reads");
assert.equal(reads?.availability, "available");
assert.equal(reads?.value, 512_000);
assert.equal(reads?.source, "ingested-signal");
assert.ok(reads?.evidence.includes("signal-1"));
assert.equal(ingested.observations.find((observation) => observation.domain === "bandwidth")?.source, "operator-entry");

const healthy = evaluateInstitutionHealth({ state: basicState, usage: oversizedUsage, violations: [], monitoringIncomplete: true, now });
assert.equal(healthy.level, "healthy");
const attention = evaluateInstitutionHealth({ state: secured, usage: oversizedUsage, violations, monitoringIncomplete: false, now });
assert.equal(attention.level, "attention");
assert.ok(attention.reasons.length >= 3);
const critical = evaluateInstitutionHealth({ state: suspendedInstitution, usage: oversizedUsage, violations: [], monitoringIncomplete: false, now });
assert.equal(critical.level, "critical");
const unknownUsage = evaluateInstitutionHealth({ state: basicState, usage: null, violations: [], monitoringIncomplete: false, now });
assert.equal(unknownUsage.level, "unknown", "missing usage is reported rather than assumed healthy");

/* --------------------- platform access is separate from institutions ---------- */

assert.deepEqual(capabilitiesFor("Owner" as unknown as PlatformRole), [], "institution roles receive no platform capabilities");
assert.equal(canPlatform("Admin" as unknown as PlatformRole, "institutions.view"), false, "institution admins cannot reach the console");
assert.equal(canPlatform("Platform Owner", "operators.manage"), true);
assert.equal(canPlatform("Platform Administrator", "operators.manage"), false, "administrators cannot manage operators");
assert.equal(canPlatform("Platform Support", "institutions.manage"), false, "support is read-only");
assert.throws(() => requirePlatformCapability("Platform Analyst", "plans.assign"), /FORBIDDEN/);
assert.doesNotThrow(() => requirePlatformCapability("Platform Administrator", "plans.assign"));

const supportOperator = {
  uid: "support-1", email: "support@veqweris.test", platformRole: "Platform Support" as PlatformRole,
  status: "active" as const, grantedBy: "platform-owner", grantReason: "Support desk onboarding", grantedAt: now,
};
const analystOperator = {
  uid: "analyst-1", email: "analyst@veqweris.test", platformRole: "Platform Analyst" as PlatformRole,
  status: "active" as const, grantedBy: "platform-owner", grantReason: "Reporting", grantedAt: now,
};
const supportGrant = createSupportGrant({
  institutionId: "institution-1",
  operator: { uid: supportOperator.uid, platformRole: supportOperator.platformRole },
  scopes: ["institution.overview", "usage.view"],
  reason: "Investigating a reported billing question",
  now,
});
assert.equal(canAccessInstitution({ operator: supportOperator, institutionId: "institution-1", grants: [supportGrant], now }), true);
assert.equal(canAccessInstitution({ operator: supportOperator, institutionId: "institution-2", grants: [supportGrant], now }), false, "support cannot roam between tenants");
assert.equal(canAccessInstitution({ operator: analystOperator, institutionId: "institution-2", grants: [], now }), true, "analysts read authorized institutions without grants");

/* ------------------------- support tools: scoped and visible ------------------ */

assert.equal(supportGrant.readOnly, true);
assert.equal(supportGrant.status, "active");
assert.equal(supportGrant.expiresAt, "2026-03-01T01:00:00.000Z", "default support access lasts one hour");
assert.equal(isSupportGrantActive(supportGrant, "2026-03-01T00:59:00.000Z"), true);
assert.equal(isSupportGrantActive(supportGrant, "2026-03-01T01:00:01.000Z"), false);
assert.equal(scopeAllows(supportGrant, "usage.view", now), true);
assert.equal(scopeAllows(supportGrant, "billing.view", now), false, "ungranted scopes stay closed");
assert.throws(() => createSupportGrant({ institutionId: "institution-1", operator: supportOperator, scopes: ["usage.view"], reason: "short", now }), /explicit reason/i);
assert.throws(() => createSupportGrant({ institutionId: "institution-1", operator: supportOperator, scopes: [], reason: "No scopes supplied", now }), /at least one authorized scope/i);
assert.throws(() => createSupportGrant({ institutionId: "institution-1", operator: supportOperator, scopes: ["usage.view"], reason: "Too long a window", durationMinutes: 481, now }), /between 1 and 480/i);
const revokedGrant = revokeSupportGrant(supportGrant, "platform-owner", "Question resolved", "2026-03-01T00:20:00.000Z");
assert.equal(revokedGrant.status, "revoked");
assert.equal(isSupportGrantActive(revokedGrant, now), false);
assert.equal(scopeAllows(revokedGrant, "usage.view", now), false);
const securityEvent = supportSecurityEvent(supportGrant);
assert.equal(securityEvent.type, "sensitive_action");
assert.equal(securityEvent.visibleToInstitution, true, "support access is never silent");

/* --------------------------- operator bootstrap guard ------------------------ */

const allowlist = bootstrapEmails("Owner@Veqweris.test, second@veqweris.test");
assert.deepEqual(allowlist, ["owner@veqweris.test", "second@veqweris.test"]);
assert.equal(canBootstrapOperator({ email: "owner@veqweris.test", emailVerified: true, activeOperatorCount: 0, allowlist }).allowed, true);
assert.equal(canBootstrapOperator({ email: "owner@veqweris.test", emailVerified: true, activeOperatorCount: 1, allowlist }).allowed, false);
assert.equal(canBootstrapOperator({ email: "owner@veqweris.test", emailVerified: false, activeOperatorCount: 0, allowlist }).allowed, false);
assert.equal(canBootstrapOperator({ email: "stranger@example.com", emailVerified: true, activeOperatorCount: 0, allowlist }).allowed, false);

/* ------------------- institution administration view stays tenant-safe -------- */

const view = buildInstitutionAdministrationView({
  state: internalAssigned,
  institution: { name: "Internal Operations", country: "KE", createdAt: "2025-01-05T00:00:00.000Z" },
  usage: oversizedUsage,
  signals: [{
    signalId: "security-signal",
    institutionId: "institution-1",
    domain: "security",
    metric: "security-events",
    value: 3,
    unit: "events",
    source: "platform-agent",
    note: "security signal",
    capturedAt: now,
    recordedBy: "platform-agent",
  }],
  grants: [supportGrant],
  now,
});
assert.equal(view.name, "Internal Operations");
assert.equal(view.planId, "internal");
assert.equal(view.relationship, "Customer", "plan assignment left the relationship untouched");
assert.equal(view.billingState.status, "not_applicable", "Internal billing is disabled");
assert.equal(view.usage?.users, 30);
assert.equal(view.supportGrants.length, 1);
assert.equal(view.createdAt, "2025-01-05T00:00:00.000Z");
assert.ok(!Object.keys(view).some((key) => ["employees", "patients", "tasks", "messages", "documents"].includes(key)));
assert.ok(!JSON.stringify(view).includes("patient-"), "no tenant operational records are embedded in the platform view");
assert.throws(() => assertPlatformSafeView({ employees: [] }), /cannot expose employees/);
assert.throws(() => assertPlatformSafeView({ usage: { tasks: [{ taskId: "t1" }] } }), /aggregate, not tenant records/);

const overviewGrant = createSupportGrant({
  institutionId: view.institutionId,
  operator: { uid: supportOperator.uid, platformRole: supportOperator.platformRole },
  scopes: ["institution.overview"],
  reason: "Overview regression test",
  now,
});
const scoped = applySupportScopeRedaction(view, overviewGrant, now);
assert.equal(scoped.view.usage, null, "usage is withheld without the usage scope");
assert.equal(scoped.view.monitoring.available, 0);
assert.equal(scoped.view.supportGrants.length, 0);
for (const field of [
  "securityLevel", "securityState", "health", "billingEnabled", "billingState", "planId",
  "planName", "planCategory", "plan", "subscription", "entitlement", "modules", "policies",
]) {
  assert.equal(field in scoped.view, false, `overview-only support cannot see ${field}`);
}
assert.ok(scoped.withheldScopes.includes("usage.view"));
assert.ok(scoped.withheldScopes.includes("billing.view"));
assert.throws(() => applySupportScopeRedaction(view, { ...overviewGrant, institutionId: "another-institution" }, now), /active support grant/i);
assert.throws(() => applySupportScopeRedaction(view, {
  ...overviewGrant,
  scopes: ["usage.view"],
}, now), /active support grant/i);
const usageGrant = createSupportGrant({
  institutionId: view.institutionId,
  operator: { uid: supportOperator.uid, platformRole: supportOperator.platformRole },
  scopes: ["institution.overview", "usage.view"],
  reason: "Usage scope regression test",
  now,
});
const usageScoped = applySupportScopeRedaction(view, usageGrant, now);
assert.ok(usageScoped.view.monitoring.observations.every((observation) => observation.domain !== "security"));
const billingGrant = createSupportGrant({
  institutionId: view.institutionId,
  operator: { uid: supportOperator.uid, platformRole: supportOperator.platformRole },
  scopes: ["institution.overview", "billing.view"],
  reason: "Billing scope regression test",
  now,
});
const billingScoped = applySupportScopeRedaction(view, billingGrant, now);
assert.equal(billingScoped.view.subscription?.planId, view.subscription.planId);
assert.equal("securityState" in billingScoped.view, false);
const securityGrant = createSupportGrant({
  institutionId: view.institutionId,
  operator: { uid: supportOperator.uid, platformRole: supportOperator.platformRole },
  scopes: ["institution.overview", "security.view"],
  reason: "Security scope regression test",
  now,
});
const securityScoped = applySupportScopeRedaction(view, securityGrant, now);
assert.equal(securityScoped.view.securityLevel, view.securityLevel);
assert.equal("billingState" in securityScoped.view, false);
assert.equal("subscription" in securityScoped.view, false);
const fullyScopedGrant = createSupportGrant({
  institutionId: view.institutionId,
  operator: { uid: supportOperator.uid, platformRole: supportOperator.platformRole },
  scopes: ["institution.overview", "usage.view", "billing.view", "security.view", "audit.view"],
  reason: "Fully scoped regression test",
  now,
});
const fullScoped = applySupportScopeRedaction(view, fullyScopedGrant, now);
assert.equal(fullScoped.view.usage?.users, 30);
assert.equal(fullScoped.view.securityLevel, view.securityLevel);
assert.ok(fullScoped.view.health);
assert.ok(fullScoped.view.billingState);
assert.ok(fullScoped.view.subscription);
assert.equal(fullScoped.view.health.reasons.length, view.health.reasons.length);
assert.equal(fullScoped.view.billingState.status, view.billingState.status);
assert.equal(fullScoped.view.subscription.planId, view.subscription.planId);
assert.equal(fullScoped.withheldScopes.length, 0);

/* ------------------------------- console statistics --------------------------- */

const summaries: PlatformInstitutionSummary[] = [
  { institutionId: "a", name: "A", country: "KE", status: "active", relationship: "Internal", planId: "internal", planName: "Internal", planCategory: "internal", billingEnabled: false, securityLevel: "standard", modules: [] },
  { institutionId: "b", name: "B", country: "NG", status: "active", relationship: "Customer", planId: "basic", planName: "Basic", planCategory: "commercial", billingEnabled: true, securityLevel: "standard", modules: [] },
  { institutionId: "c", name: "C", country: "UG", status: "suspended", relationship: "Strategic Partner", planId: "partner", planName: "Partner", planCategory: "partner", billingEnabled: false, securityLevel: "elevated", modules: [] },
];
const stats = platformDashboardStats(summaries);
assert.equal(stats.total, 3);
assert.equal(stats.suspended, 1);
assert.equal(stats.billingEnabled, 1);
assert.equal(stats.billingExempt, 2);
assert.equal(stats.byPlanCategory.commercial, 1);
assert.equal(stats.byPlanCategory.partner, 1);
assert.equal(stats.byRelationship.Customer, 1);

/* --------------------- audit reuses the single governance engine ------------- */

const firstAudit = createAuditEvent({
  eventId: "platform-1", institutionId: "platform", actorUid: "platform-owner",
  action: "plan.assigned", resourceType: "institution", resourceId: "institution-1",
  payload: { planId: "internal" }, occurredAt: now, previousHash: null, sequence: 0,
});
const secondAudit = createAuditEvent({
  eventId: "platform-2", institutionId: "platform", actorUid: "platform-owner",
  action: "relationship.assigned", resourceType: "institution", resourceId: "institution-1",
  payload: { relationship: "Strategic Partner" }, occurredAt: now, previousHash: firstAudit.hash, sequence: 1,
});
assert.ok(firstAudit.hash.length > 0 && firstAudit.hash !== secondAudit.hash, "platform audit events hash deterministically through governance");
assert.deepEqual(resolveEntitlement(requirePlan("basic"), {}, "platform", now, context).planId, "basic");

console.log("platform administration engine tests passed");
