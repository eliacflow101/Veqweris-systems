import "server-only";
import { permissionScopeAllows } from "@/lib/permissions/engine";
import type { PermissionContext } from "@/lib/permissions/server";
import type { PermissionScope } from "@/lib/permissions/registry";

type DocumentReadAuthorization = Pick<PermissionContext, "uid" | "institutionId" | "tier" | "grants" | "membership">;

export function canReadDocument(record: Record<string, unknown>, context: DocumentReadAuthorization): boolean {
  if (record.institutionId !== context.institutionId) return false;
  const isOwnerOrAdmin = context.tier === "Owner" || context.tier === "Admin";
  const departmentId = typeof record.departmentId === "string" ? record.departmentId : null;
  const explicitlyShared = Array.isArray(record.allowedViewers) && record.allowedViewers.includes(context.uid);
  const roleAllows = isOwnerOrAdmin
    || record.uploadedBy === context.uid
    || departmentId === null
    || (context.tier === "Manager" && context.membership.departmentIds.includes(departmentId))
    || explicitlyShared;
  if (!roleAllows) return false;

  const grant = context.grants.find((entry) => entry.key === "documents.read");
  if (!grant) return false;
  const scope: PermissionScope = {
    institutionId: context.institutionId,
    recordOwnerUid: typeof record.uploadedBy === "string" ? record.uploadedBy : "",
  };
  const dimensions = [
    ["locationId", "locationIds", "locationIds"],
    ["unitId", "unitIds", "unitIds"],
    ["departmentId", "departmentIds", "departmentIds"],
  ] as const;
  for (const [recordField, scopeField, membershipField] of dimensions) {
    const roleValues = grant.scope?.[scopeField];
    const membershipValues = context.membership[membershipField];
    const value = record[recordField];
    if ((roleValues !== undefined || membershipValues.length > 0)
      && (typeof value !== "string" || !value.trim())) return false;
    if (typeof value === "string" && value.trim()) scope[scopeField] = [value];
  }
  return permissionScopeAllows(grant, context.membership, scope, context.uid);
}
