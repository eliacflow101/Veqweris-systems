import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { requireInstitutionModuleEntitlement } from "@/lib/platform/tenant-entitlements";
import {
  compileEffectivePermissions,
  defaultMembership,
  isStepUpAuthenticationRecent,
  membershipIsActive,
  permissionScopeAllows,
  type CustomRoleAuthorization,
  type EffectivePermission,
  type MembershipAuthorization,
} from "./engine";
import { isSystemTier, PERMISSION_REGISTRY, type PermissionScope, type SystemTier } from "./registry";

export class PermissionAuthorizationError extends Error {
  constructor(readonly status: 401 | 403 | 409, message: string) {
    super(message);
    this.name = "PermissionAuthorizationError";
  }
}

export type PermissionContext = {
  uid: string;
  institutionId: string;
  tier: SystemTier;
  permissionVersion: number;
  grants: EffectivePermission[];
  membership: MembershipAuthorization;
  decoded: DecodedIdToken;
};

function tierForProfile(role: unknown): SystemTier {
  return isSystemTier(role) ? role : "Employee";
}

function claimsEqual(left: Record<string, unknown>, right: Record<string, unknown>) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function compileStaffAuthorization(uid: string, options: { revokeTokens?: boolean } = {}) {
  if (!adminAuth || !adminDb) throw new Error("Firebase server is not configured.");
  const profileSnapshot = await adminDb.collection("users").doc(uid).get();
  const profile = profileSnapshot.data();
  if (!profileSnapshot.exists || !profile || typeof profile.institutionId !== "string") {
    throw new PermissionAuthorizationError(403, "Institution profile is required.");
  }

  const institutionId = profile.institutionId;
  const membershipRef = adminDb.collection("memberships").doc(uid);
  let membershipSnapshot = await membershipRef.get();
  if (!membershipSnapshot.exists) {
    const membership = defaultMembership({
      institutionId,
      tier: tierForProfile(profile.role),
      departmentId: typeof profile.departmentId === "string" ? profile.departmentId : null,
    });
    await membershipRef.create({
      ...membership,
      uid,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "system:permission-compiler",
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "system:permission-compiler",
      schemaVersion: 1,
    });
    membershipSnapshot = await membershipRef.get();
  }

  const rawMembership = membershipSnapshot.data();
  if (!membershipSnapshot.exists || !rawMembership || rawMembership.institutionId !== institutionId) {
    throw new PermissionAuthorizationError(403, "Institution membership is unavailable.");
  }
  const membership = rawMembership as MembershipAuthorization;
  if (!isSystemTier(membership.tier) || membership.tier !== tierForProfile(profile.role)) {
    throw new PermissionAuthorizationError(409, "Membership tier does not match the institution profile.");
  }
  if (!Array.isArray(membership.roleIds) || membership.roleIds.length > 10
    || membership.roleIds.some((roleId) => typeof roleId !== "string" || !roleId.trim() || roleId.length > 128)) {
    throw new Error("Membership role assignments are invalid.");
  }
  const roles = membership.roleIds.length
    ? await adminDb.getAll(...membership.roleIds.map((roleId) => adminDb!.collection("roles").doc(roleId)))
    : [];
  const customRoles: CustomRoleAuthorization[] = roles.flatMap((snapshot) => {
    const data = snapshot.data();
    return snapshot.exists && data && data.institutionId === institutionId
      ? [{ ...data, roleId: snapshot.id } as CustomRoleAuthorization]
      : [];
  });
  const grants = compileEffectivePermissions(membership, customRoles);
  const version = membership.permissionVersion;
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("Membership permission version is invalid.");

  const authUser = await adminAuth.getUser(uid);
  const customClaims: Record<string, unknown> = {
    ...authUser.customClaims,
    iid: institutionId,
    tier: membership.tier,
    pt: profile.status === "active" && membershipIsActive(membership) ? "staff" : "inactive",
    pv: version,
  };
  const legacyRoles = ["Clinician", "Nurse", "Reception", "Billing", "Laboratory", "Pharmacist"];
  if (typeof profile.role === "string" && legacyRoles.includes(profile.role)) {
    customClaims.legacyRole = profile.role;
  } else {
    delete customClaims.legacyRole;
  }

  const now = FieldValue.serverTimestamp();
  await adminDb.collection("effectivePermissions").doc(uid).set({
    uid,
    institutionId,
    version,
    grants,
    permissionKeys: grants.map(({ key }) => key),
    status: membership.status,
    createdAt: membershipSnapshot.get("createdAt") ?? now,
    createdBy: membershipSnapshot.get("createdBy") ?? "system:permission-compiler",
    updatedAt: now,
    updatedBy: "system:permission-compiler",
    schemaVersion: 1,
  });

  if (Buffer.byteLength(JSON.stringify(customClaims), "utf8") > 1000) {
    throw new Error("Authorization claims exceed the Firebase size limit.");
  }
  const changed = !claimsEqual(authUser.customClaims ?? {}, customClaims);
  if (changed) {
    await adminAuth.setCustomUserClaims(uid, customClaims);
    if (options.revokeTokens) await adminAuth.revokeRefreshTokens(uid);
  }
  return { membership, grants, claimsChanged: changed };
}

export async function synchronizePrincipalClaims(uid: string) {
  if (!adminAuth || !adminDb) throw new Error("Firebase server is not configured.");
  const profile = await adminDb.collection("users").doc(uid).get();
  if (profile.exists && profile.get("status") === "active" && typeof profile.get("institutionId") === "string") {
    return (await compileStaffAuthorization(uid)).claimsChanged;
  }

  const portal = await adminDb.collection("portalAccounts").doc(uid).get();
  const operator = await adminDb.collection("platformOperators").doc(uid).get();
  let principalType: "external" | "platform" | "pending";
  let institutionId = "";
  if (portal.exists && portal.get("status") === "active" && typeof portal.get("institutionId") === "string") {
    principalType = "external";
    institutionId = portal.get("institutionId") as string;
  } else if (operator.exists && operator.get("status") === "active") {
    principalType = "platform";
  } else if (!profile.exists && !portal.exists && !operator.exists) {
    principalType = "pending";
  } else {
    throw new PermissionAuthorizationError(403, "No active VEQWERIS principal is registered.");
  }

  const authUser = await adminAuth.getUser(uid);
  const customClaims = {
    ...authUser.customClaims,
    iid: institutionId,
    tier: "none",
    pt: principalType,
    pv: 0,
  };
  if (Buffer.byteLength(JSON.stringify(customClaims), "utf8") > 1000) {
    throw new Error("Authorization claims exceed the Firebase size limit.");
  }
  const changed = !claimsEqual(authUser.customClaims ?? {}, customClaims);
  if (changed) await adminAuth.setCustomUserClaims(uid, customClaims);
  return changed;
}

export async function requirePermission(
  request: Request,
  permissionKey: string,
  scope: PermissionScope = {},
  options: { stepUp?: boolean } = {},
): Promise<PermissionContext> {
  const definition = PERMISSION_REGISTRY[permissionKey];
  if (!definition) throw new PermissionAuthorizationError(403, "Permission is not registered.");
  const token = await getSessionToken(request);
  if (!token) throw new PermissionAuthorizationError(401, "Authentication required.");
  const decoded = await verifyActiveSession(token);
  if (!adminDb || decoded.pt !== "staff" || typeof decoded.iid !== "string"
    || !isSystemTier(decoded.tier) || !Number.isSafeInteger(decoded.pv)) {
    throw new PermissionAuthorizationError(409, "Authorization claims are stale; refresh the session.");
  }

  const [profileSnapshot, membershipSnapshot, effectiveSnapshot] = await Promise.all([
    adminDb.collection("users").doc(decoded.uid).get(),
    adminDb.collection("memberships").doc(decoded.uid).get(),
    adminDb.collection("effectivePermissions").doc(decoded.uid).get(),
  ]);
  const profile = profileSnapshot.data();
  const rawMembership = membershipSnapshot.data();
  const effective = effectiveSnapshot.data();
  if (!profileSnapshot.exists || !profile || profile.status !== "active"
    || profile.institutionId !== decoded.iid || tierForProfile(profile.role) !== decoded.tier
    || !membershipSnapshot.exists || !rawMembership
    || rawMembership.institutionId !== decoded.iid || rawMembership.status !== "active"
    || !effectiveSnapshot.exists || !effective || effective.institutionId !== decoded.iid
    || effective.version !== decoded.pv || rawMembership.permissionVersion !== decoded.pv
    || rawMembership.tier !== decoded.tier) {
    throw new PermissionAuthorizationError(409, "Authorization changed; refresh the session.");
  }
  const membership = rawMembership as MembershipAuthorization;
  if (!membershipIsActive(membership)) {
    throw new PermissionAuthorizationError(403, "Active institution membership is required.");
  }
  const grant = Array.isArray(effective.grants)
    ? (effective.grants as Array<{ key: string; scope?: PermissionScope }>).find((entry) => entry.key === permissionKey)
    : undefined;
  if (!grant || !permissionScopeAllows(grant, membership, scope, decoded.uid)) {
    throw new PermissionAuthorizationError(403, "Permission or requested scope is not granted.");
  }
  const moduleId = definition.module === "organization" ? "settings" : definition.module;
  try {
    await requireInstitutionModuleEntitlement(decoded.iid, moduleId);
  } catch (reason) {
    if (reason instanceof Error && reason.message === "FORBIDDEN") {
      throw new PermissionAuthorizationError(403, "The institution is not entitled to this module.");
    }
    throw reason;
  }
  if (definition.dangerous && options.stepUp !== false
    && !isStepUpAuthenticationRecent(decoded.auth_time)) {
    throw new PermissionAuthorizationError(403, "Recent reauthentication is required for this permission.");
  }

  return {
    uid: decoded.uid,
    institutionId: decoded.iid,
    tier: decoded.tier,
    permissionVersion: decoded.pv as number,
    grants: effective.grants as EffectivePermission[],
    membership,
    decoded,
  };
}
