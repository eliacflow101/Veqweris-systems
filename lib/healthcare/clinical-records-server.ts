import "server-only";
import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type Transaction } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { sessionTokenHash } from "@/lib/firebase/server-auth";
import { institutionHasModuleEntitlementInTransaction } from "@/lib/platform/tenant-entitlements";
import {
  membershipIsActive,
  permissionScopeAllows,
  type MembershipAuthorization,
  type PermissionGrant,
} from "@/lib/permissions/engine";
import { isSystemTier, PERMISSION_REGISTRY, type PermissionScope, type SensitivityClass } from "@/lib/permissions/registry";
import type { PermissionContext } from "@/lib/permissions/server";

const recordTypes = ["observation", "diagnosis", "procedure", "prescription", "note"] as const;
const sensitivities = ["standard", "sensitive", "highly_sensitive"] as const;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const idempotencyPattern = /^[A-Za-z0-9._:-]{16,128}$/;
const scopeDimensions = [
  ["locationIds", "locationId", "locations"],
  ["unitIds", "unitId", "operationalUnits"],
  ["departmentIds", "departmentId", "departments"],
] as const;

const persistedRecordFields = new Set([
  "clinicalRecordId", "institutionId", "patientId", "encounterId", "recordType", "summary",
  "sensitivity", "authoredBy", "createdAt", "updatedAt", "specialtyId", "locationId", "unitId", "departmentId",
]);

export class ClinicalRecordRequestError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 503, message: string) {
    super(message);
    this.name = "ClinicalRecordRequestError";
  }
}

export type ClinicalRecordCreateInput = {
  idempotencyKey: string;
  patientId: string;
  encounterId: string;
  recordType: typeof recordTypes[number];
  summary: string;
  sensitivity: typeof sensitivities[number];
  specialtyId?: string | null;
  locationId?: string;
  unitId?: string;
  departmentId?: string;
};

export type ClinicalRecordPatch = {
  idempotencyKey: string;
  recordType?: typeof recordTypes[number];
  summary?: string;
  sensitivity?: typeof sensitivities[number];
  specialtyId?: string | null;
};

export type AuthorizedClinicalRecord = {
  clinicalRecordId: string;
  institutionId: string;
  patientId: string;
  encounterId: string;
  recordType: typeof recordTypes[number];
  summary: string;
  sensitivity: typeof sensitivities[number];
  authoredBy: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  specialtyId?: string | null;
  locationId?: string;
  unitId?: string;
  departmentId?: string;
};

export type ClinicalAuthorizationState = {
  profile: Record<string, unknown>;
  membership: MembershipAuthorization;
  grant: PermissionGrant;
  readGrant?: PermissionGrant;
  writeGrant?: PermissionGrant;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ClinicalRecordRequestError(400, "The request contains unsupported fields.");
  }
}

function validateIdempotencyKey(value: unknown): asserts value is string {
  if (typeof value !== "string" || !idempotencyPattern.test(value)) {
    throw new ClinicalRecordRequestError(400, "A valid idempotency key is required.");
  }
}

export function parseClinicalRecordCreate(value: unknown): ClinicalRecordCreateInput {
  if (!isObject(value)) throw new ClinicalRecordRequestError(400, "A clinical record object is required.");
  assertOnlyKeys(value, [
    "idempotencyKey", "patientId", "encounterId", "recordType", "summary", "sensitivity", "specialtyId",
    "locationId", "unitId", "departmentId",
  ]);
  validateIdempotencyKey(value.idempotencyKey);
  if (!validId(value.patientId) || !validId(value.encounterId)) {
    throw new ClinicalRecordRequestError(400, "Valid patient and encounter identifiers are required.");
  }
  if (typeof value.recordType !== "string" || !recordTypes.includes(value.recordType as typeof recordTypes[number])) {
    throw new ClinicalRecordRequestError(400, "The clinical record type is invalid.");
  }
  if (typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 4000) {
    throw new ClinicalRecordRequestError(400, "A summary of at most 4000 characters is required.");
  }
  if (typeof value.sensitivity !== "string" || !sensitivities.includes(value.sensitivity as typeof sensitivities[number])) {
    throw new ClinicalRecordRequestError(400, "The clinical record sensitivity is invalid.");
  }
  if (value.specialtyId !== undefined && value.specialtyId !== null && !validId(value.specialtyId)) {
    throw new ClinicalRecordRequestError(400, "The specialty identifier is invalid.");
  }
  for (const field of ["locationId", "unitId", "departmentId"] as const) {
    if (value[field] !== undefined && !validId(value[field])) {
      throw new ClinicalRecordRequestError(400, `The ${field} is invalid.`);
    }
  }
  return {
    idempotencyKey: value.idempotencyKey,
    patientId: value.patientId,
    encounterId: value.encounterId,
    recordType: value.recordType as ClinicalRecordCreateInput["recordType"],
    summary: value.summary.trim(),
    sensitivity: value.sensitivity as ClinicalRecordCreateInput["sensitivity"],
    ...(value.specialtyId === undefined ? {} : { specialtyId: value.specialtyId as string | null }),
    ...(value.locationId === undefined ? {} : { locationId: value.locationId as string }),
    ...(value.unitId === undefined ? {} : { unitId: value.unitId as string }),
    ...(value.departmentId === undefined ? {} : { departmentId: value.departmentId as string }),
  };
}

export function parseClinicalRecordPatch(value: unknown): ClinicalRecordPatch {
  if (!isObject(value)) throw new ClinicalRecordRequestError(400, "A clinical record update object is required.");
  assertOnlyKeys(value, ["idempotencyKey", "recordType", "summary", "sensitivity", "specialtyId"]);
  validateIdempotencyKey(value.idempotencyKey);
  const patch: ClinicalRecordPatch = { idempotencyKey: value.idempotencyKey };
  if (value.recordType !== undefined) {
    if (typeof value.recordType !== "string" || !recordTypes.includes(value.recordType as typeof recordTypes[number])) {
      throw new ClinicalRecordRequestError(400, "The clinical record type is invalid.");
    }
    patch.recordType = value.recordType as ClinicalRecordPatch["recordType"];
  }
  if (value.summary !== undefined) {
    if (typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 4000) {
      throw new ClinicalRecordRequestError(400, "A summary of at most 4000 characters is required.");
    }
    patch.summary = value.summary.trim();
  }
  if (value.sensitivity !== undefined) {
    if (typeof value.sensitivity !== "string" || !sensitivities.includes(value.sensitivity as typeof sensitivities[number])) {
      throw new ClinicalRecordRequestError(400, "The clinical record sensitivity is invalid.");
    }
    patch.sensitivity = value.sensitivity as ClinicalRecordPatch["sensitivity"];
  }
  if (value.specialtyId !== undefined) {
    if (value.specialtyId !== null && !validId(value.specialtyId)) {
      throw new ClinicalRecordRequestError(400, "The specialty identifier is invalid.");
    }
    patch.specialtyId = value.specialtyId as string | null;
  }
  if (Object.keys(patch).length === 1) throw new ClinicalRecordRequestError(400, "At least one supported field must be updated.");
  return patch;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function clinicalRequestHash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function clinicalIdempotencyDocumentId(
  uid: string,
  institutionId: string,
  operation: "create" | "update",
  key: string,
): string {
  return createHash("sha256").update(`${uid}:${institutionId}:clinical-record:${operation}:${key}`).digest("hex");
}

function sameStrings(left: unknown, right: string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function canonicalGrantScope(grant: PermissionGrant): Record<string, unknown> {
  return isObject(grant.scope) ? grant.scope : {};
}

function validMembership(value: unknown, context: PermissionContext): value is MembershipAuthorization {
  if (!isObject(value) || !isSystemTier(value.tier)
    || value.institutionId !== context.institutionId
    || value.tier !== context.tier
    || value.permissionVersion !== context.permissionVersion
    || value.status !== "active"
    || !Array.isArray(value.roleIds)
    || !value.roleIds.every((roleId) => validId(roleId))
    || !["departmentIds", "unitIds", "teamIds", "locationIds"].every((key) =>
      Array.isArray(value[key]) && (value[key] as unknown[]).every((item) => validId(item)))
    || (value.validFrom !== undefined && typeof value.validFrom !== "number")
    || (value.validTo !== undefined && value.validTo !== null && typeof value.validTo !== "number")
    || (value.sensitivityCeiling !== undefined
      && !["INTERNAL", "CONFIDENTIAL", "RESTRICTED"].includes(String(value.sensitivityCeiling)))) return false;
  return membershipIsActive(value as unknown as MembershipAuthorization);
}

function validPermissionScope(value: unknown, institutionId: string): value is PermissionScope {
  if (!isObject(value)) return false;
  if (value.institutionId !== undefined && value.institutionId !== institutionId) return false;
  if (value.ownRecordsOnly !== undefined && typeof value.ownRecordsOnly !== "boolean") return false;
  if (value.sensitivityCeiling !== undefined
    && !["INTERNAL", "CONFIDENTIAL", "RESTRICTED"].includes(String(value.sensitivityCeiling))) return false;
  for (const [dimension] of scopeDimensions) {
    if (value[dimension] !== undefined
      && (!Array.isArray(value[dimension])
        || !(value[dimension] as unknown[]).every((item) => typeof item === "string" && item.length > 0))) return false;
  }
  return Object.keys(value).every((key) =>
    ["institutionId", "ownRecordsOnly", "sensitivityCeiling", ...scopeDimensions.map(([dimension]) => dimension)].includes(key));
}

function parseEffectiveClinicalGrants(
  effective: Record<string, unknown>,
  institutionId: string,
): { readGrant?: PermissionGrant; writeGrant?: PermissionGrant } | null {
  if (!Array.isArray(effective.grants) || !Array.isArray(effective.permissionKeys) || !isObject(effective.permissionScopes)) return null;
  const grants = effective.grants as unknown[];
  if (!grants.every((grant) => isObject(grant) && typeof grant.key === "string")) return null;
  const keys = grants.map((grant) => (grant as { key: string }).key);
  if (new Set(keys).size !== keys.length
    || !keys.every((key) => PERMISSION_REGISTRY[key])
    || !sameStrings(effective.permissionKeys, keys)
    || !sameStrings(Object.keys(effective.permissionScopes).sort(), [...keys].sort())) return null;
  for (const rawGrant of grants) {
    const grant = rawGrant as PermissionGrant;
    if (grant.scope !== undefined && !isObject(grant.scope)) return null;
    const mappedScope = effective.permissionScopes[grant.key];
    if (!isObject(mappedScope) || stable(mappedScope) !== stable(canonicalGrantScope(grant))) return null;
  }
  const readGrant = grants.find((grant) => (grant as { key: string }).key === "health.record.read") as PermissionGrant | undefined;
  const writeGrant = grants.find((grant) => (grant as { key: string }).key === "health.record.write") as PermissionGrant | undefined;
  if ((readGrant && !validPermissionScope(canonicalGrantScope(readGrant), institutionId))
    || (writeGrant && !validPermissionScope(canonicalGrantScope(writeGrant), institutionId))) return null;
  return { ...(readGrant ? { readGrant } : {}), ...(writeGrant ? { writeGrant } : {}) };
}

export async function readClinicalAuthorizationState(
  transaction: Transaction,
  context: PermissionContext,
  sessionToken: string,
  permissionKey: "health.record.read" | "health.record.write",
): Promise<ClinicalAuthorizationState> {
  if (!adminDb) throw new ClinicalRecordRequestError(503, "Clinical record service is unavailable.");
  const uid = context.uid;
  const [profileSnapshot, membershipSnapshot, effectiveSnapshot, sessionSnapshot] = await transaction.getAll(
    adminDb.collection("users").doc(uid),
    adminDb.collection("memberships").doc(uid),
    adminDb.collection("effectivePermissions").doc(uid),
    adminDb.collection("securitySessions").doc(sessionTokenHash(sessionToken)),
  );
  const profile = profileSnapshot.data();
  const membershipData = membershipSnapshot.data();
  const effective = effectiveSnapshot.data();
  const session = sessionSnapshot.data();
  if (!profileSnapshot.exists || !profile || profile.status !== "active"
    || profile.institutionId !== context.institutionId || profile.role !== context.tier
    || !membershipSnapshot.exists || !validMembership(membershipData, context)
    || !effectiveSnapshot.exists || !effective
    || effective.status !== "active"
    || effective.institutionId !== context.institutionId
    || effective.version !== context.permissionVersion
    || effective.version !== context.decoded.pv
    || !sessionSnapshot.exists || !session || session.uid !== uid
    || session.institutionId !== context.institutionId || session.status !== "active"
    || !(session.expiresAt instanceof Timestamp) || session.expiresAt.toMillis() <= Date.now()) {
    throw new ClinicalRecordRequestError(409, "Authorization is no longer current.");
  }
  if (!await institutionHasModuleEntitlementInTransaction(transaction, context.institutionId, "healthcare")) {
    throw new ClinicalRecordRequestError(403, "Healthcare access is unavailable.");
  }
  const grants = parseEffectiveClinicalGrants(effective, context.institutionId);
  const grant = permissionKey === "health.record.read" ? grants?.readGrant : grants?.writeGrant;
  if (!grants || !grant) throw new ClinicalRecordRequestError(409, "Authorization data is unavailable or inconsistent.");
  return { profile, membership: membershipData, grant, ...grants };
}

function sensitivityClass(value: AuthorizedClinicalRecord["sensitivity"]): SensitivityClass {
  if (value === "standard") return "INTERNAL";
  if (value === "sensitive") return "CONFIDENTIAL";
  return "RESTRICTED";
}

function assertRecordShape(
  record: unknown,
  clinicalRecordId: string,
  institutionId: string,
  allowAdditionalFields = false,
): asserts record is AuthorizedClinicalRecord {
  const validRecordId = allowAdditionalFields
    ? (value: unknown) => typeof value === "string" && value.length > 0
    : validId;
  if (!isObject(record) || (!allowAdditionalFields && Object.keys(record).some((key) => !persistedRecordFields.has(key)))
    || record.clinicalRecordId !== clinicalRecordId || record.institutionId !== institutionId
    || !validRecordId(record.patientId) || !validRecordId(record.encounterId)
    || typeof record.recordType !== "string" || !recordTypes.includes(record.recordType as typeof recordTypes[number])
    || typeof record.summary !== "string"
    || (!allowAdditionalFields && (!record.summary.trim() || record.summary.length > 4000))
    || typeof record.sensitivity !== "string" || !sensitivities.includes(record.sensitivity as typeof sensitivities[number])
    || !validRecordId(record.authoredBy)
    || !(record.createdAt instanceof Timestamp)
    || (record.updatedAt !== undefined && !(record.updatedAt instanceof Timestamp))
    || (record.specialtyId !== undefined && record.specialtyId !== null && !validRecordId(record.specialtyId))
    || scopeDimensions.some(([, field]) => record[field] !== undefined && !validRecordId(record[field]))) {
    throw new ClinicalRecordRequestError(409, "The clinical record is invalid or unavailable.");
  }
}

export async function assertClinicalRecordScope(
  transaction: Transaction | null,
  state: ClinicalAuthorizationState,
  context: PermissionContext,
  recordValue: unknown,
  clinicalRecordId: string,
  options: { validateReferences?: boolean; allowAdditionalFields?: boolean; requireSpecialty?: boolean } = {},
): Promise<AuthorizedClinicalRecord> {
  const validateReferences = options.validateReferences !== false;
  assertRecordShape(recordValue, clinicalRecordId, context.institutionId, options.allowAdditionalFields === true);
  const record = recordValue;
  if (record.authoredBy !== context.uid) {
    const ownOnly = state.grant.scope?.ownRecordsOnly;
    if (ownOnly) throw new ClinicalRecordRequestError(403, "Clinical record access is not authorized.");
  }
  if (validateReferences) {
    if (!transaction) throw new ClinicalRecordRequestError(503, "Clinical record service is unavailable.");
    const [patientSnapshot, encounterSnapshot] = await transaction.getAll(
      adminDb!.collection("patientIdentities").doc(record.patientId),
      adminDb!.collection("healthcareEncounters").doc(record.encounterId),
    );
    const patient = patientSnapshot.data();
    const encounter = encounterSnapshot.data();
    if (!patientSnapshot.exists || !patient || patient.patientId !== record.patientId
      || patient.institutionId !== context.institutionId
      || !encounterSnapshot.exists || !encounter
      || encounter.encounterId !== record.encounterId
      || encounter.institutionId !== context.institutionId
      || encounter.patientId !== record.patientId) {
      throw new ClinicalRecordRequestError(404, "The patient or encounter is unavailable.");
    }
  }
  if (!Array.isArray(state.profile.assignedPatientIds)
    || !state.profile.assignedPatientIds.every((patientId) => validId(patientId))
    || !state.profile.assignedPatientIds.includes(record.patientId)) {
    throw new ClinicalRecordRequestError(403, "Clinical record access is not authorized.");
  }
  if ((state.profile.specialtyId !== undefined && state.profile.specialtyId !== null
      && !validId(state.profile.specialtyId))
    || (state.profile.specialtyIds !== undefined
      && (!Array.isArray(state.profile.specialtyIds)
        || !state.profile.specialtyIds.every((specialtyId) => validId(specialtyId))))) {
    throw new ClinicalRecordRequestError(409, "Authorization data is unavailable or inconsistent.");
  }
  const dimensionRefs = validateReferences
    ? scopeDimensions.flatMap(([, field, collectionName]) =>
      record[field] ? [adminDb!.collection(collectionName).doc(record[field]!)] : [])
    : [];
  if (validateReferences && !transaction) {
    throw new ClinicalRecordRequestError(503, "Clinical record service is unavailable.");
  }
  const dimensionSnapshots = dimensionRefs.length ? await transaction!.getAll(...dimensionRefs) : [];
  const requested: PermissionScope = {
    institutionId: context.institutionId,
    sensitivityCeiling: sensitivityClass(record.sensitivity),
    ...(state.grant.scope?.ownRecordsOnly
      ? { ownRecordsOnly: true, recordOwnerUid: record.authoredBy }
      : {}),
  };
  let dimensionIndex = 0;
  for (const [grantDimension, field] of scopeDimensions) {
    const membershipValues = state.membership[grantDimension];
    const grantConstrained = Object.prototype.hasOwnProperty.call(state.grant.scope ?? {}, grantDimension);
    const membershipConstrained = membershipValues.length > 0 || state.membership.tier === "Manager";
    const value = record[field];
    if ((grantConstrained || membershipConstrained) && !validId(value)) {
      throw new ClinicalRecordRequestError(403, "Clinical record scope is not authorized.");
    }
    if (value !== undefined) {
      if (validateReferences) {
        const dimensionSnapshot = dimensionSnapshots[dimensionIndex++];
        if (!dimensionSnapshot?.exists || dimensionSnapshot.get("institutionId") !== context.institutionId) {
          throw new ClinicalRecordRequestError(403, "Clinical record scope is not authorized.");
        }
      }
      requested[grantDimension] = [value];
    }
  }
  let allowed = false;
  try {
    allowed = permissionScopeAllows(state.grant, state.membership, requested, context.uid);
  } catch {
    throw new ClinicalRecordRequestError(409, "Authorization data is unavailable or inconsistent.");
  }
  if (!allowed) throw new ClinicalRecordRequestError(403, "Clinical record access is not authorized.");
  const specialtyIds = [
    ...(typeof state.profile.specialtyId === "string" ? [state.profile.specialtyId] : []),
    ...(Array.isArray(state.profile.specialtyIds) ? state.profile.specialtyIds : []),
  ];
  if ((record.specialtyId !== undefined && record.specialtyId !== null && !specialtyIds.includes(record.specialtyId))
    || (options.requireSpecialty !== false && specialtyIds.length > 0 && !record.specialtyId)) {
    throw new ClinicalRecordRequestError(403, "Clinical record access is not authorized.");
  }
  return record;
}

export function clinicalWriteCapabilities(state: ClinicalAuthorizationState, context: PermissionContext) {
  const grant = state.writeGrant;
  if (!grant) return null;
  const profileSpecialtyIds = [
    ...(typeof state.profile.specialtyId === "string" ? [state.profile.specialtyId] : []),
    ...(Array.isArray(state.profile.specialtyIds) ? state.profile.specialtyIds : []),
  ];
  if ((state.profile.specialtyId !== undefined && state.profile.specialtyId !== null
      && !validId(state.profile.specialtyId))
    || (state.profile.specialtyIds !== undefined
      && (!Array.isArray(state.profile.specialtyIds)
        || !state.profile.specialtyIds.every((specialtyId) => validId(specialtyId))))) {
    throw new ClinicalRecordRequestError(409, "Authorization data is unavailable or inconsistent.");
  }
  const dimensions = Object.fromEntries(scopeDimensions.map(([grantDimension, field]) => {
    const grantScope = grant.scope ?? {};
    const grantConstrained = Object.prototype.hasOwnProperty.call(grantScope, grantDimension);
    const grantValues = grantScope[grantDimension] ?? [];
    const membershipValues = state.membership[grantDimension];
    const membershipConstrained = membershipValues.length > 0 || state.membership.tier === "Manager";
    const constrained = grantConstrained || membershipConstrained;
    const allowedIds = grantConstrained && membershipConstrained
      ? grantValues.filter((value) => membershipValues.includes(value))
      : grantConstrained ? grantValues
        : membershipConstrained ? membershipValues : [];
    if (!allowedIds.every(validId)) {
      throw new ClinicalRecordRequestError(409, "Authorization data is unavailable or inconsistent.");
    }
    return [field, { required: constrained, allowedIds }];
  }));
  const allowedSensitivities = sensitivities.filter((sensitivity) => {
    try {
      return permissionScopeAllows(grant, state.membership, {
        institutionId: context.institutionId,
        sensitivityCeiling: sensitivityClass(sensitivity),
        ...(grant.scope?.ownRecordsOnly ? { recordOwnerUid: context.uid } : {}),
      }, context.uid);
    } catch {
      throw new ClinicalRecordRequestError(409, "Authorization data is unavailable or inconsistent.");
    }
  });
  return { specialtyIds: profileSpecialtyIds, sensitivities: allowedSensitivities, dimensions };
}

export function createClinicalAuditFields(
  context: PermissionContext,
  operation: "create" | "update",
  clinicalRecordId: string,
) {
  return {
    institutionId: context.institutionId,
    actorUid: context.uid,
    permission: "health.record.write",
    permissionVersion: context.permissionVersion,
    operation,
    clinicalRecordId,
    occurredAt: FieldValue.serverTimestamp(),
    schemaVersion: 1,
  };
}

export function createClinicalReadAuditFields(context: PermissionContext, clinicalRecordIds: string[]) {
  return {
    institutionId: context.institutionId,
    actorUid: context.uid,
    permission: "health.record.read",
    permissionVersion: context.permissionVersion,
    operation: "read",
    clinicalRecordIds,
    occurredAt: FieldValue.serverTimestamp(),
    schemaVersion: 1,
  };
}
