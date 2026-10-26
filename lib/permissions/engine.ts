import type { PermissionScope, SensitivityClass, SystemTier } from "./registry";
import { PERMISSION_REGISTRY, SYSTEM_TIERS, tierRank } from "./registry";

export type PermissionGrant = { key: string; scope?: PermissionScope };
export type MembershipAuthorization = {
  institutionId: string;
  tier: SystemTier;
  roleIds: string[];
  departmentIds: string[];
  unitIds: string[];
  teamIds: string[];
  locationIds: string[];
  permissionVersion: number;
  sensitivityCeiling?: SensitivityClass;
  status: "active" | "inactive";
  validFrom?: number;
  validTo?: number | null;
};
export type CustomRoleAuthorization = {
  roleId: string;
  institutionId: string;
  tierCeiling: SystemTier;
  permissions: PermissionGrant[];
  status: "active" | "inactive";
  version: number;
};
export type EffectivePermission = PermissionGrant & { module: string; sensitivity: SensitivityClass; dangerous: boolean };

const BASE_TIER_PERMISSIONS: Record<SystemTier, string[]> = {
  Employee: ["dashboard.summary.read", "departments.read", "employees.read", "tasks.read", "inventory.stock.read"],
  Manager: ["dashboard.summary.read", "departments.read", "employees.read", "tasks.read", "tasks.manage", "inventory.stock.read", "inventory.stock.adjust", "organization.teams.manage"],
  Admin: Object.keys(PERMISSION_REGISTRY).filter((key) => !["health.record.read", "school.safeguarding.read"].includes(key)),
  Owner: Object.keys(PERMISSION_REGISTRY),
};

const DIMENSIONS = [
  ["locationIds", "locationIds"],
  ["unitIds", "unitIds"],
  ["departmentIds", "departmentIds"],
  ["teamIds", "teamIds"],
] as const;

const SENSITIVITY_RANK: Record<SensitivityClass, number> = {
  INTERNAL: 0,
  CONFIDENTIAL: 1,
  RESTRICTED: 2,
};

export function defaultMembership(input: {
  institutionId: string;
  tier: SystemTier;
  departmentId?: string | null;
}): MembershipAuthorization {
  return {
    institutionId: input.institutionId,
    tier: input.tier,
    roleIds: [],
    departmentIds: input.departmentId ? [input.departmentId] : [],
    unitIds: [],
    teamIds: [],
    locationIds: [],
    permissionVersion: 1,
    sensitivityCeiling: input.tier === "Owner" || input.tier === "Admin" ? "RESTRICTED"
      : input.tier === "Manager" ? "CONFIDENTIAL" : "INTERNAL",
    status: "active",
  };
}

export function membershipIsActive(membership: MembershipAuthorization, now = Date.now()): boolean {
  return membership.status === "active"
    && (membership.validFrom === undefined || membership.validFrom <= now)
    && (membership.validTo === undefined || membership.validTo === null || membership.validTo > now);
}

export function compileEffectivePermissions(
  membership: MembershipAuthorization,
  roles: CustomRoleAuthorization[],
  now = Date.now(),
): EffectivePermission[] {
  if (!membershipIsActive(membership, now)) return [];

  const tier = membership.tier;
  const grants = new Map<string, PermissionScope | undefined>();
  for (const key of BASE_TIER_PERMISSIONS[tier]) grants.set(key, undefined);

  for (const roleId of membership.roleIds.slice(0, 10)) {
    const role = roles.find((candidate) => candidate.roleId === roleId
      && candidate.institutionId === membership.institutionId
      && candidate.status === "active");
    if (!role || tierRank(tier) > tierRank(role.tierCeiling)) continue;
    for (const grant of role.permissions) {
      const definition = PERMISSION_REGISTRY[grant.key];
      if (!definition || tierRank(tier) < tierRank(definition.lowestTier)) continue;
      if (!grants.has(grant.key)) grants.set(grant.key, grant.scope);
      else if (grant.scope) grants.set(grant.key, intersectScopes(grants.get(grant.key), grant.scope));
    }
  }

  return [...grants.entries()].flatMap(([key, scope]) => {
    const definition = PERMISSION_REGISTRY[key];
    if (!definition || tierRank(tier) < tierRank(definition.lowestTier)) return [];
    return [{
      key,
      ...(scope ? { scope } : {}),
      module: definition.module,
      sensitivity: definition.sensitivity,
      dangerous: definition.dangerous,
    }];
  });
}

export function intersectScopes(left: PermissionScope | undefined, right: PermissionScope): PermissionScope {
  if (!left) return right;
  const result: PermissionScope = {};
  for (const [scopeKey] of DIMENSIONS) {
    const first = left[scopeKey];
    const second = right[scopeKey];
    if (first && second) result[scopeKey] = first.filter((value) => second.includes(value));
    else if (first || second) result[scopeKey] = first ?? second;
  }
  if (left.institutionId && right.institutionId && left.institutionId !== right.institutionId) {
    result.institutionId = "";
  } else result.institutionId = left.institutionId ?? right.institutionId;
  result.ownRecordsOnly = Boolean(left.ownRecordsOnly || right.ownRecordsOnly);
  const leftSensitivity = left.sensitivityCeiling ?? "INTERNAL";
  const rightSensitivity = right.sensitivityCeiling ?? "INTERNAL";
  result.sensitivityCeiling = SENSITIVITY_RANK[leftSensitivity] <= SENSITIVITY_RANK[rightSensitivity]
    ? leftSensitivity
    : rightSensitivity;
  if (left.academic || right.academic) {
    result.academic = {};
    for (const key of ["levels", "classes", "streams", "subjects"] as const) {
      const first = left.academic?.[key];
      const second = right.academic?.[key];
      if (first && second) result.academic[key] = first.filter((value) => second.includes(value));
      else if (first || second) result.academic[key] = first ?? second;
    }
  }
  return result;
}

export function permissionScopeAllows(
  grant: PermissionGrant,
  membership: MembershipAuthorization,
  requested: PermissionScope,
  actorUid: string,
): boolean {
  const definition = PERMISSION_REGISTRY[grant.key];
  if (!definition || !membershipIsActive(membership)) return false;
  if (grant.scope?.institutionId && grant.scope.institutionId !== membership.institutionId) return false;
  if (requested.institutionId && requested.institutionId !== membership.institutionId) return false;
  const roleScope = grant.scope;
  const membershipValues: Record<(typeof DIMENSIONS)[number][0], string[]> = {
    locationIds: membership.locationIds,
    unitIds: membership.unitIds,
    departmentIds: membership.departmentIds,
    teamIds: membership.teamIds,
  };
  for (const [key] of DIMENSIONS) {
    const requestedValues = requested[key];
    if (!requestedValues?.length) continue;
    const allowed = roleScope?.[key];
    if (allowed && requestedValues.some((value) => !allowed.includes(value))) return false;
    if ((membership.tier === "Manager" || membershipValues[key].length > 0)
      && requestedValues.some((value) => !membershipValues[key].includes(value))) return false;
  }
  if (requested.academic) {
    for (const key of ["levels", "classes", "streams", "subjects"] as const) {
      const values = requested.academic[key] ?? [];
      const allowed = roleScope?.academic?.[key];
      if (allowed && values.some((value) => !allowed.includes(value))) return false;
    }
  }
  if ((roleScope?.ownRecordsOnly || requested.ownRecordsOnly) && requested.recordOwnerUid !== actorUid) return false;
  const sensitivity = requested.sensitivityCeiling ?? definition.sensitivity;
  const scopeCeiling = roleScope?.sensitivityCeiling ?? definition.sensitivity;
  const membershipCeiling = membership.sensitivityCeiling
    ?? (membership.tier === "Owner" || membership.tier === "Admin" ? "RESTRICTED"
      : membership.tier === "Manager" ? "CONFIDENTIAL" : "INTERNAL");
  const ceiling = SENSITIVITY_RANK[scopeCeiling] <= SENSITIVITY_RANK[membershipCeiling]
    ? scopeCeiling
    : membershipCeiling;
  if (SENSITIVITY_RANK[sensitivity] > SENSITIVITY_RANK[ceiling]) return false;
  return true;
}

export function isStepUpAuthenticationRecent(authTime: unknown, nowSeconds = Math.floor(Date.now() / 1000)) {
  return typeof authTime === "number" && authTime <= nowSeconds && nowSeconds - authTime <= 300;
}

export function canGrantPermission(
  actorTier: SystemTier,
  actorPermissions: EffectivePermission[],
  requested: PermissionGrant,
): boolean {
  const definition = PERMISSION_REGISTRY[requested.key];
  if (!definition || tierRank(actorTier) < tierRank(definition.lowestTier)) return false;
  if (actorTier === "Owner") return true;
  const held = actorPermissions.find((permission) => permission.key === requested.key);
  if (!held) return false;
  if (!requested.scope) return !held.scope;
  if (!held.scope) return true;
  return permissionScopeAllows(
    held,
    {
      institutionId: held.scope.institutionId ?? "",
      tier: actorTier,
      roleIds: [],
      departmentIds: held.scope.departmentIds ?? [],
      unitIds: held.scope.unitIds ?? [],
      teamIds: held.scope.teamIds ?? [],
      locationIds: held.scope.locationIds ?? [],
      permissionVersion: 0,
      status: "active",
    },
    requested.scope,
    "",
  );
}
