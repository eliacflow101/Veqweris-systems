import { deterministicId } from "@/lib/governance";
import { getInstitutionType } from "@/lib/configuration/registry";
import { defaultPlanForNewInstitution, defaultPlatformState } from "@/lib/platform/engine";
import { coreModuleIds, extendedModuleIds } from "@/lib/platform/models";

export type ProvisioningRequest = {
  institutionName: string;
  country: string;
  fullName: string;
  email: string;
  institutionType: string;
  idempotencyKey: string;
};

export type ProvisioningProgress = "pending" | "provisioning" | "completed" | "failed" | "reconciled";

export type ProvisioningStep = {
  name: string;
  status: "pending" | "completed" | "failed";
  message?: string;
};

export function validateProvisioningRequest(input: unknown): ProvisioningRequest {
  if (!input || typeof input !== "object") throw new Error("A provisioning payload is required.");
  const body = input as Record<string, unknown>;
  const institutionName = typeof body.institutionName === "string" ? body.institutionName.trim() : "";
  const country = typeof body.country === "string" ? body.country.trim() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const institutionType = typeof body.institutionType === "string" ? body.institutionType.trim() : "general-business";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!institutionName || institutionName.length > 120) throw new Error("Institution name is required and must be under 120 characters.");
  if (!country || country.length > 80) throw new Error("Country is required and must be under 80 characters.");
  if (!fullName || fullName.length > 120) throw new Error("A full name is required and must be under 120 characters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email is required.");
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) throw new Error("A valid idempotency key is required.");

  const typeRecord = getInstitutionType(institutionType) ?? getInstitutionType("general-business");
  if (!typeRecord) throw new Error("The selected institution type is not recognised.");

  return {
    institutionName,
    country,
    fullName,
    email,
    institutionType: typeRecord.code,
    idempotencyKey,
  };
}

export function buildProvisioningRequestHash(uid: string, request: ProvisioningRequest): string {
  return deterministicId("provreq", {
    uid,
    institutionName: request.institutionName,
    country: request.country,
    fullName: request.fullName,
    email: request.email,
    institutionType: request.institutionType,
    idempotencyKey: request.idempotencyKey,
  });
}

export function createProvisioningRun(input: {
  uid: string;
  institutionId: string;
  institutionName: string;
  country: string;
  email: string;
  institutionType: string;
  idempotencyKey: string;
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const steps: ProvisioningStep[] = [
    { name: "identity_validated", status: "completed", message: "Authenticated user and request details were validated." },
    { name: "institution_record_created", status: "pending" },
    { name: "owner_membership_created", status: "pending" },
    { name: "subscription_entitlement_applied", status: "pending" },
    { name: "initial_location_created", status: "pending" },
    { name: "audit_logged", status: "pending" },
  ];

  return {
    runId: deterministicId("provrun", {
      uid: input.uid,
      institutionId: input.institutionId,
      institutionName: input.institutionName,
      country: input.country,
      email: input.email,
      idempotencyKey: input.idempotencyKey,
    }),
    institutionId: input.institutionId,
    uid: input.uid,
    email: input.email,
    institutionName: input.institutionName,
    country: input.country,
    institutionType: input.institutionType,
    idempotencyKey: input.idempotencyKey,
    status: "pending" as ProvisioningProgress,
    progress: 0,
    steps,
    createdAt: now,
    updatedAt: now,
    failureReason: null,
  };
}

export function createInitialInstitutionRecord(input: {
  institutionId: string;
  createdBy: string;
  institutionName: string;
  country: string;
  institutionType: string;
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const institutionType = getInstitutionType(input.institutionType) ?? getInstitutionType("general-business");
  const platformState = defaultPlatformState(input.institutionId, input.createdBy, now, {
    tenantModules: [...new Set([...coreModuleIds, ...extendedModuleIds])].map((moduleId) => ({
      moduleId,
      label: moduleId,
      section: "default",
      platformOnly: false,
    })),
    plans: undefined,
  });

  return {
    institutionId: input.institutionId,
    createdBy: input.createdBy,
    name: input.institutionName,
    country: input.country,
    institutionType: input.institutionType,
    configPackId: institutionType?.packId ?? "general",
    status: "active",
    planTier: platformState.planTier,
    relationship: platformState.relationship,
    subscription: platformState.subscription,
    entitlement: platformState.entitlement,
    policies: platformState.policies,
    securityState: platformState.securityState,
    billingState: platformState.billingState,
    location: {
      name: `${input.institutionName} Main Site`,
      type: "single-site",
      country: input.country,
      active: true,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function computeInstitutionId(uid: string, request: ProvisioningRequest): string {
  return deterministicId("inst", {
    uid,
    institutionType: request.institutionType,
    institutionName: request.institutionName,
    country: request.country,
    email: request.email,
    idempotencyKey: request.idempotencyKey,
  });
}

export const stage26ProvisioningDefaults = {
  defaultPlanId: defaultPlanForNewInstitution().planId,
  defaultModules: [...new Set([...coreModuleIds, ...extendedModuleIds])],
};
