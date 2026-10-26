import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  canGrantPermission,
  defaultMembership,
  permissionScopeAllows,
  type CustomRoleAuthorization,
  type MembershipAuthorization,
} from "@/lib/permissions/engine";
import { compileStaffAuthorization, PermissionAuthorizationError, requirePermission } from "@/lib/permissions/server";
import { isSystemTier, type PermissionScope, type SystemTier } from "@/lib/permissions/registry";

const MAX_SCOPE_IDS = 50;
const SCOPE_DIMENSIONS = ["locationIds", "unitIds", "departmentIds", "teamIds"] as const;
type MembershipScopeDimension = typeof SCOPE_DIMENSIONS[number];

function stringIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SCOPE_IDS
    || value.some((id) => typeof id !== "string" || !id.trim() || id.length > 128)) {
    throw new Error("INVALID_MEMBERSHIP");
  }
  return [...new Set(value as string[])];
}

function targetTier(role: unknown): SystemTier {
  return isSystemTier(role) ? role : "Employee";
}

function scopeIsRestricted(
  actor: Awaited<ReturnType<typeof requirePermission>>,
  grant: NonNullable<typeof actor.grants[number]>,
  dimension: MembershipScopeDimension,
) {
  return actor.tier === "Manager"
    || actor.membership[dimension].length > 0
    || grant.scope?.[dimension] !== undefined;
}

function assertScopeValuesAllowed(
  actor: Awaited<ReturnType<typeof requirePermission>>,
  grant: NonNullable<typeof actor.grants[number]>,
  dimension: MembershipScopeDimension,
  values: string[],
) {
  for (const value of values) {
    const requested: PermissionScope = { [dimension]: [value] };
    if (!permissionScopeAllows(grant, actor.membership, requested, actor.uid)) {
      throw new Error("OUT_OF_SCOPE");
    }
  }
}

function assertMembershipScopeAllowed(
  actor: Awaited<ReturnType<typeof requirePermission>>,
  grant: NonNullable<typeof actor.grants[number]>,
  current: MembershipAuthorization,
  requested: Partial<Record<MembershipScopeDimension, string[]>>,
) {
  for (const dimension of SCOPE_DIMENSIONS) {
    const currentValues = current[dimension];
    if (!Array.isArray(currentValues)) throw new Error("INVALID_MEMBERSHIP");
    const restricted = scopeIsRestricted(actor, grant, dimension);
    if (restricted && currentValues.length === 0) throw new Error("OUT_OF_SCOPE");
    assertScopeValuesAllowed(actor, grant, dimension, currentValues);

    const requestedValues = requested[dimension];
    if (requestedValues === undefined) continue;
    if (restricted && requestedValues.length === 0) throw new Error("OUT_OF_SCOPE");
    assertScopeValuesAllowed(actor, grant, dimension, requestedValues);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requirePermission(request, "organization.memberships.manage");
    if (!adminDb || !adminAuth) {
      return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    }
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.uid !== "string" || !body.uid || typeof body.reason !== "string" || !body.reason.trim()
      || typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 16 || body.idempotencyKey.length > 128) {
      return NextResponse.json({ error: "A member, reason, and idempotency key are required." }, { status: 400 });
    }
    const uid = body.uid;
    const reason = body.reason.trim();
    if (uid === actor.uid) return NextResponse.json({ error: "You cannot change your own access assignment." }, { status: 403 });

    const roleIds = body.roleIds === undefined ? undefined : stringIds(body.roleIds);
    if (roleIds && roleIds.length > 10) throw new Error("INVALID_MEMBERSHIP");
    const departmentIds = body.departmentIds === undefined ? undefined : stringIds(body.departmentIds);
    const unitIds = body.unitIds === undefined ? undefined : stringIds(body.unitIds);
    const teamIds = body.teamIds === undefined ? undefined : stringIds(body.teamIds);
    const locationIds = body.locationIds === undefined ? undefined : stringIds(body.locationIds);
    const sensitivityCeiling = body.sensitivityCeiling;
    if (sensitivityCeiling !== undefined
      && !["INTERNAL", "CONFIDENTIAL", "RESTRICTED"].includes(String(sensitivityCeiling))) {
      throw new Error("INVALID_MEMBERSHIP");
    }
    const status = body.status;
    if (status !== undefined && status !== "active" && status !== "inactive") throw new Error("INVALID_MEMBERSHIP");

    const profileRef = adminDb.collection("users").doc(uid);
    const membershipRef = adminDb.collection("memberships").doc(uid);
    const idempotencyHash = createHash("sha256")
      .update(`${actor.uid}:${actor.institutionId}:membership:${body.idempotencyKey}`)
      .digest("hex");
    const requestHash = createHash("sha256")
      .update(JSON.stringify({
        institutionId: actor.institutionId,
        uid,
        roleIds: roleIds ?? null,
        departmentIds: departmentIds ?? null,
        unitIds: unitIds ?? null,
        teamIds: teamIds ?? null,
        locationIds: locationIds ?? null,
        sensitivityCeiling: sensitivityCeiling ?? null,
        status: status ?? null,
        reason,
      }))
      .digest("hex");
    const idempotencyRef = adminDb.collection("requestIdempotency").doc(idempotencyHash);
    const auditRef = adminDb.collection("securityEvents").doc();
    const scopeCollections = [
      ...(departmentIds ?? []).map((id) => adminDb!.collection("departments").doc(id)),
      ...(unitIds ?? []).map((id) => adminDb!.collection("operationalUnits").doc(id)),
      ...(teamIds ?? []).map((id) => adminDb!.collection("teams").doc(id)),
      ...(locationIds ?? []).map((id) => adminDb!.collection("locations").doc(id)),
      ...(roleIds ?? []).map((id) => adminDb!.collection("roles").doc(id)),
    ];
    const now = FieldValue.serverTimestamp();

    const result = await adminDb.runTransaction(async (transaction) => {
      const refs = [profileRef, membershipRef, idempotencyRef, ...scopeCollections];
      const snapshots = await transaction.getAll(...refs);
      const profile = snapshots[0];
      const currentMembership = snapshots[1];
      const idempotency = snapshots[2];
      if (idempotency.exists) {
        if (idempotency.get("institutionId") !== actor.institutionId
          || idempotency.get("requestHash") !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT");
        return { replay: true, permissionVersion: Number(idempotency.get("version") ?? 0) };
      }
      if (!profile.exists || profile.get("institutionId") !== actor.institutionId
        || (profile.get("status") !== "active" && !(status === "active" && currentMembership.exists))) {
        throw new Error("MEMBER_NOT_FOUND");
      }
      if (profile.get("role") === "Owner") throw new Error("OWNER_PROTECTED");
      const tier = targetTier(profile.get("role"));
      const prior = currentMembership.exists
        ? currentMembership.data() as MembershipAuthorization
        : defaultMembership({
          institutionId: actor.institutionId,
          tier,
          departmentId: typeof profile.get("departmentId") === "string" ? profile.get("departmentId") : null,
        });
      if (prior.institutionId !== actor.institutionId || prior.tier !== tier) throw new Error("MEMBERSHIP_INCONSISTENT");
      const membershipGrant = actor.grants.find((grant) => grant.key === "organization.memberships.manage");
      if (!membershipGrant) throw new PermissionAuthorizationError(403, "Membership management permission is required.");
      assertMembershipScopeAllowed(actor, membershipGrant, prior, {
        ...(departmentIds === undefined ? {} : { departmentIds }),
        ...(unitIds === undefined ? {} : { unitIds }),
        ...(teamIds === undefined ? {} : { teamIds }),
        ...(locationIds === undefined ? {} : { locationIds }),
      });

      const assignedRoleIds = roleIds ?? prior.roleIds;
      if (!Array.isArray(assignedRoleIds) || assignedRoleIds.length > 10
        || assignedRoleIds.some((roleId) => typeof roleId !== "string" || !roleId.trim() || roleId.length > 128)) {
        throw new Error("INVALID_MEMBERSHIP");
      }
      const scopeCount = (departmentIds ?? []).length + (unitIds ?? []).length
        + (teamIds ?? []).length + (locationIds ?? []).length;
      const roleSnapshots = roleIds === undefined ? [] : snapshots.slice(3 + scopeCount);
      const roles: CustomRoleAuthorization[] = roleSnapshots.flatMap((snapshot) => {
        const role = snapshot.data();
        return snapshot.exists && role?.institutionId === actor.institutionId
          ? [{ ...role, roleId: snapshot.id } as CustomRoleAuthorization]
          : [];
      });
      if (roleIds !== undefined && roles.length !== roleIds.length) throw new Error("INVALID_ROLE_ASSIGNMENT");
      for (const role of roles) {
        if (role.status !== "active" || !isSystemTier(role.tierCeiling)
          || ["Owner", "Admin"].includes(String(profile.get("role"))) && role.tierCeiling === "Owner") {
          throw new Error("INVALID_ROLE_ASSIGNMENT");
        }
        if (prior.tier === "Manager" && role.tierCeiling === "Owner") throw new Error("INVALID_ROLE_ASSIGNMENT");
        if (role.permissions.some((grant) => !canGrantPermission(actor.tier, actor.grants, grant))) {
          throw new PermissionAuthorizationError(403, "You cannot assign access you do not hold.");
        }
      }

      const assignedScopeDocuments = snapshots.slice(3, 3 + scopeCollections.length);
      const scopeEntries = [
        ...(departmentIds ?? []).map((id) => ({ id, institutionId: assignedScopeDocuments.shift()?.get("institutionId") })),
        ...(unitIds ?? []).map((id) => ({ id, institutionId: assignedScopeDocuments.shift()?.get("institutionId") })),
        ...(teamIds ?? []).map((id) => ({ id, institutionId: assignedScopeDocuments.shift()?.get("institutionId") })),
        ...(locationIds ?? []).map((id) => ({ id, institutionId: assignedScopeDocuments.shift()?.get("institutionId") })),
      ];
      if (scopeEntries.some((entry) => entry.institutionId !== actor.institutionId)) throw new Error("INVALID_SCOPE");
      const next: MembershipAuthorization = {
        ...prior,
        institutionId: actor.institutionId,
        tier,
        roleIds: assignedRoleIds,
        departmentIds: departmentIds ?? prior.departmentIds,
        unitIds: unitIds ?? prior.unitIds,
        teamIds: teamIds ?? prior.teamIds,
        locationIds: locationIds ?? prior.locationIds,
        sensitivityCeiling: (sensitivityCeiling ?? prior.sensitivityCeiling ?? defaultMembership({
          institutionId: actor.institutionId,
          tier,
        }).sensitivityCeiling) as MembershipAuthorization["sensitivityCeiling"],
        status: status ?? prior.status,
        permissionVersion: prior.permissionVersion + 1,
      };
      const roleAssignmentPermissions = roles.flatMap((role) => role.permissions);
      if (roleAssignmentPermissions.some((grant) => !canGrantPermission(actor.tier, actor.grants, grant))) {
        throw new PermissionAuthorizationError(403, "You cannot grant a permission or scope you do not hold.");
      }
      transaction.set(membershipRef, {
        ...next,
        uid,
        createdAt: currentMembership.get("createdAt") ?? now,
        createdBy: currentMembership.get("createdBy") ?? actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
        schemaVersion: 1,
      });
      if (status !== undefined) {
        transaction.update(profileRef, {
          status,
          updatedAt: now,
          updatedBy: actor.uid,
        });
      }
      transaction.create(auditRef, {
        eventId: auditRef.id,
        institutionId: actor.institutionId,
        uid: actor.uid,
        type: "role_change",
        source: "organization.memberships",
        details: {
          action: "membership_permissions_updated",
          reference: uid,
          result: "success",
          previousState: prior,
          newState: next,
          reason: reason.slice(0, 500),
        },
        createdAt: now,
      });
      transaction.create(idempotencyRef, {
        idempotencyKey: idempotencyHash,
        requestHash,
        institutionId: actor.institutionId,
        resultId: uid,
        version: next.permissionVersion,
        createdAt: now,
        createdBy: actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
        status: "completed",
        schemaVersion: 1,
      });
      return { replay: false, permissionVersion: next.permissionVersion };
    });

    await compileStaffAuthorization(uid, { revokeTokens: true });
    return NextResponse.json({ uid, permissionVersion: result.permissionVersion, replay: result.replay });
  } catch (reason) {
    if (reason instanceof PermissionAuthorizationError) {
      return NextResponse.json({ error: reason.message }, { status: reason.status });
    }
    const code = reason instanceof Error ? reason.message : "";
    if (code === "IDEMPOTENCY_CONFLICT") {
      return NextResponse.json({ error: "The idempotency key was already used for a different request." }, { status: 409 });
    }
    const status = code === "OWNER_PROTECTED" || code === "OUT_OF_SCOPE" ? 403
      : code === "MEMBER_NOT_FOUND" ? 404
        : code === "INVALID_ROLE_ASSIGNMENT" || code === "INVALID_SCOPE" || code === "INVALID_MEMBERSHIP" ? 400
          : 500;
    if (status === 500) console.error("Unable to update institution membership.", reason);
    return NextResponse.json({
      error: code === "OUT_OF_SCOPE" ? "You cannot manage members or scopes outside your authorized scope."
        : status === 403 ? "Owner access cannot be changed through membership assignment."
        : status === 404 ? "Institution member not found."
          : status === 400 ? "Membership roles or scopes are invalid."
            : "Unable to update member access.",
    }, { status });
  }
}
