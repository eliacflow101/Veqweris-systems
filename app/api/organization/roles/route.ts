import { createHash, randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { canGrantPermission, type PermissionGrant } from "@/lib/permissions/engine";
import {
  compileStaffAuthorization,
  PermissionAuthorizationError,
  requirePermission,
} from "@/lib/permissions/server";
import {
  isSystemTier,
  PERMISSION_REGISTRY,
  SYSTEM_ROLE_TEMPLATES,
  type PermissionScope,
} from "@/lib/permissions/registry";

const MAX_ROLE_RECOMPILE_MEMBERS = 100;

function parseScope(value: unknown, institutionId: string): PermissionScope | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SCOPE");
  const source = value as Record<string, unknown>;
  const scope: PermissionScope = { institutionId };
  for (const [inputKey, outputKey] of [
    ["locationIds", "locationIds"],
    ["unitIds", "unitIds"],
    ["departmentIds", "departmentIds"],
    ["teamIds", "teamIds"],
  ] as const) {
    const entries = source[inputKey];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length > 50
      || entries.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 128)) {
      throw new Error("INVALID_SCOPE");
    }
    scope[outputKey] = [...new Set(entries as string[])];
  }
  const academic = source.academic;
  if (academic !== undefined) {
    if (!academic || typeof academic !== "object" || Array.isArray(academic)) throw new Error("INVALID_SCOPE");
    const parsed: NonNullable<PermissionScope["academic"]> = {};
    for (const key of ["levels", "classes", "streams", "subjects"] as const) {
      const entries = (academic as Record<string, unknown>)[key];
      if (entries === undefined) continue;
      if (!Array.isArray(entries) || entries.length > 50
        || entries.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 128)) {
        throw new Error("INVALID_SCOPE");
      }
      parsed[key] = [...new Set(entries as string[])];
    }
    scope.academic = parsed;
  }
  if (source.ownRecordsOnly !== undefined) {
    if (typeof source.ownRecordsOnly !== "boolean") throw new Error("INVALID_SCOPE");
    scope.ownRecordsOnly = source.ownRecordsOnly;
  }
  if (source.sensitivityCeiling !== undefined) {
    if (!["INTERNAL", "CONFIDENTIAL", "RESTRICTED"].includes(String(source.sensitivityCeiling))) {
      throw new Error("INVALID_SCOPE");
    }
    scope.sensitivityCeiling = source.sensitivityCeiling as PermissionScope["sensitivityCeiling"];
  }
  return scope;
}

function parseGrants(value: unknown, context: Awaited<ReturnType<typeof requirePermission>>): PermissionGrant[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error("INVALID_PERMISSIONS");
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("INVALID_PERMISSIONS");
    const grant = item as Record<string, unknown>;
    if (typeof grant.key !== "string" || !PERMISSION_REGISTRY[grant.key] || seen.has(grant.key)) {
      throw new Error("INVALID_PERMISSIONS");
    }
    seen.add(grant.key);
    const scope = parseScope(grant.scope, context.institutionId);
    if (!canGrantPermission(context.tier, context.grants, { key: grant.key, scope })) {
      throw new PermissionAuthorizationError(403, "You cannot grant a permission or scope you do not hold.");
    }
    const definition = PERMISSION_REGISTRY[grant.key];
    if (scope?.sensitivityCeiling) {
      const sensitivityRank = { INTERNAL: 0, CONFIDENTIAL: 1, RESTRICTED: 2 } as const;
      if (sensitivityRank[scope.sensitivityCeiling] > sensitivityRank[definition.sensitivity]) {
        throw new Error("INVALID_SCOPE");
      }
    }
    return { key: grant.key, ...(scope ? { scope } : {}) };
  });
}

export async function GET(request: Request) {
  try {
    const context = await requirePermission(request, "organization.roles.manage", {}, { stepUp: false });
    if (!adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    const roleId = new URL(request.url).searchParams.get("roleId");
    if (roleId) {
      const role = await adminDb.collection("roles").doc(roleId).get();
      if (!role.exists || role.get("institutionId") !== context.institutionId) {
        return NextResponse.json({ error: "Role not found." }, { status: 404 });
      }
      const versions = await adminDb.collection("roleVersions").where("roleId", "==", roleId)
        .where("institutionId", "==", context.institutionId).orderBy("version", "desc").limit(20).get();
      return NextResponse.json({
        role: { ...role.data(), roleId: role.id },
        versions: versions.docs.map((snapshot) => snapshot.data()),
      });
    }
    const [roles, memberships] = await Promise.all([
      adminDb.collection("roles").where("institutionId", "==", context.institutionId).limit(100).get(),
      adminDb.collection("memberships").where("institutionId", "==", context.institutionId).limit(1000).get(),
    ]);
    const assignmentCounts: Record<string, number> = {};
    for (const membership of memberships.docs) {
      const roleIds = membership.get("roleIds");
      if (Array.isArray(roleIds)) {
        for (const assignedRoleId of roleIds) {
          if (typeof assignedRoleId === "string") assignmentCounts[assignedRoleId] = (assignmentCounts[assignedRoleId] ?? 0) + 1;
        }
      }
    }
    return NextResponse.json({
      permissions: Object.values(PERMISSION_REGISTRY),
      templates: SYSTEM_ROLE_TEMPLATES,
      roles: roles.docs.map((snapshot) => ({ ...snapshot.data(), roleId: snapshot.id })),
      assignmentCounts,
      assignmentCountsComplete: memberships.size < 1000,
    });
  } catch (reason) {
    if (reason instanceof PermissionAuthorizationError) {
      return NextResponse.json({ error: reason.message }, { status: reason.status });
    }
    console.error("Unable to load institution roles.", reason);
    return NextResponse.json({ error: "Unable to load roles and permissions." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await requirePermission(request, "organization.roles.manage");
    if (!adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 80
      || typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 16
      || body.idempotencyKey.length > 128) {
      return NextResponse.json({ error: "A role name and valid idempotency key are required." }, { status: 400 });
    }
    const name = body.name.trim();
    const tierCeiling = body.tierCeiling ?? "Employee";
    if (!isSystemTier(tierCeiling)) return NextResponse.json({ error: "Role tier ceiling is invalid." }, { status: 400 });
    const existingRoleId = typeof body.roleId === "string" ? body.roleId : undefined;
    const roleRef = existingRoleId
      ? adminDb.collection("roles").doc(existingRoleId)
      : adminDb.collection("roles").doc();
    const idempotencyHash = createHash("sha256")
      .update(`${context.uid}:${context.institutionId}:organization-role:${body.idempotencyKey}`)
      .digest("hex");
    const idempotencyRef = adminDb.collection("requestIdempotency").doc(idempotencyHash);
    const versionRef = (version: number) => adminDb!.collection("roleVersions").doc(`${roleRef.id}_v${version}`);
    const auditRef = adminDb.collection("securityEvents").doc();
    const assignedMembershipsQuery = existingRoleId
      ? adminDb.collection("memberships")
        .where("institutionId", "==", context.institutionId)
        .where("roleIds", "array-contains", existingRoleId)
        .limit(MAX_ROLE_RECOMPILE_MEMBERS + 1)
      : null;

    let permissions: PermissionGrant[];
    if (Array.isArray(body.permissions)) {
      permissions = parseGrants(body.permissions, context);
    } else if (typeof body.templateId === "string") {
      const template = SYSTEM_ROLE_TEMPLATES.find((candidate) => candidate.templateId === body.templateId);
      if (!template) return NextResponse.json({ error: "Role template not found." }, { status: 400 });
      permissions = parseGrants(template.permissions.map((key) => ({ key })), context);
    } else {
      permissions = [];
    }
    const requestHash = createHash("sha256")
      .update(JSON.stringify({
        institutionId: context.institutionId,
        roleId: existingRoleId ?? null,
        name,
        tierCeiling,
        permissions,
        reason: typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim().slice(0, 500)
          : "Role configuration updated.",
      }))
      .digest("hex");
    if (context.tier !== "Owner" && tierCeiling === "Owner") {
      return NextResponse.json({ error: "Custom roles cannot exceed your tier authority." }, { status: 403 });
    }
    const now = FieldValue.serverTimestamp();
    const result = await adminDb.runTransaction(async (transaction) => {
      const [idempotency, current] = await transaction.getAll(idempotencyRef, roleRef);
      if (idempotency.exists) {
        if (idempotency.get("institutionId") !== context.institutionId
          || idempotency.get("requestHash") !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT");
        const priorMembers = idempotency.get("affectedMemberUids");
        return {
          roleId: String(idempotency.get("resultId")),
          replay: true,
          affectedMemberUids: idempotency.get("status") === "authorization_pending" && Array.isArray(priorMembers)
            ? priorMembers.filter((uid): uid is string => typeof uid === "string")
            : [],
        };
      }
      if (existingRoleId && (!current.exists || current.get("institutionId") !== context.institutionId)) {
        throw new Error("ROLE_NOT_FOUND");
      }
      const assignedMemberships = assignedMembershipsQuery
        ? await transaction.get(assignedMembershipsQuery)
        : null;
      if (assignedMemberships && assignedMemberships.size > MAX_ROLE_RECOMPILE_MEMBERS) {
        throw new Error("ROLE_ASSIGNMENT_LIMIT");
      }
      const affectedMemberUids = assignedMemberships?.docs.map((membership) => {
        const permissionVersion = membership.get("permissionVersion");
        if (!Number.isSafeInteger(permissionVersion) || (permissionVersion as number) < 1) {
          throw new Error("MEMBERSHIP_VERSION_INVALID");
        }
        return membership.id;
      }) ?? [];
      const previous = current.exists ? current.data() : null;
      const version = Number(previous?.version ?? 0) + 1;
      const nextRole = {
        roleId: roleRef.id,
        institutionId: context.institutionId,
        name,
        tierCeiling,
        permissions,
        status: previous?.status === "inactive" ? "inactive" : "active",
        version,
        createdAt: previous?.createdAt ?? now,
        createdBy: previous?.createdBy ?? context.uid,
        updatedAt: now,
        updatedBy: context.uid,
        schemaVersion: 1,
      };
      if (current.exists) transaction.set(roleRef, nextRole);
      else transaction.create(roleRef, nextRole);
      transaction.create(versionRef(version), {
        roleVersionId: versionRef(version).id,
        roleId: roleRef.id,
        institutionId: context.institutionId,
        version,
        snapshot: nextRole,
        createdAt: now,
        createdBy: context.uid,
        updatedAt: now,
        updatedBy: context.uid,
        status: "active",
        schemaVersion: 1,
      });
      for (const membership of assignedMemberships?.docs ?? []) {
        transaction.update(membership.ref, {
          permissionVersion: (membership.get("permissionVersion") as number) + 1,
          updatedAt: now,
          updatedBy: context.uid,
        });
      }
      transaction.create(auditRef, {
        eventId: auditRef.id,
        institutionId: context.institutionId,
        uid: context.uid,
        type: "role_change",
        source: "organization.roles",
        details: {
          action: previous ? "role_updated" : "role_created",
          reference: roleRef.id,
          result: "success",
          previousState: previous,
          newState: nextRole,
          affectedMemberCount: affectedMemberUids.length,
          reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : "Role configuration updated.",
        },
        createdAt: now,
      });
      transaction.create(idempotencyRef, {
        idempotencyKey: idempotencyHash,
        requestHash,
        institutionId: context.institutionId,
        resultId: roleRef.id,
        affectedMemberUids,
        createdAt: now,
        createdBy: context.uid,
        updatedAt: now,
        updatedBy: context.uid,
        status: affectedMemberUids.length ? "authorization_pending" : "completed",
        schemaVersion: 1,
      });
      return { roleId: roleRef.id, replay: false, affectedMemberUids };
    });
    for (let index = 0; index < result.affectedMemberUids.length; index += 10) {
      await Promise.all(result.affectedMemberUids.slice(index, index + 10)
        .map((uid) => compileStaffAuthorization(uid, { revokeTokens: true })));
    }
    if (result.affectedMemberUids.length) {
      await idempotencyRef.update({
        status: "completed",
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: context.uid,
      });
    }
    return NextResponse.json({
      roleId: result.roleId,
      replay: result.replay,
      affectedMemberCount: result.affectedMemberUids.length,
    }, { status: result.replay ? 200 : 201 });
  } catch (reason) {
    if (reason instanceof PermissionAuthorizationError) {
      return NextResponse.json({ error: reason.message }, { status: reason.status });
    }
    const code = reason instanceof Error ? reason.message : "";
    if (code === "ROLE_NOT_FOUND") return NextResponse.json({ error: "Role not found." }, { status: 404 });
    if (code === "ROLE_ASSIGNMENT_LIMIT") {
      return NextResponse.json({ error: "The role is assigned to too many members for a safe synchronous update." }, { status: 409 });
    }
    if (code === "IDEMPOTENCY_CONFLICT") {
      return NextResponse.json({ error: "The idempotency key was already used for a different request." }, { status: 409 });
    }
    if (code === "INVALID_SCOPE" || code === "INVALID_PERMISSIONS") {
      return NextResponse.json({ error: "The role contains an invalid permission or scope." }, { status: 400 });
    }
    console.error("Unable to save institution role.", reason);
    return NextResponse.json({ error: "Unable to save role." }, { status: 500 });
  }
}
