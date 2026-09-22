import type { BulkImportCandidate, DuplicateState, OperationalAccessProfile, WorkforceRole } from "@/lib/firebase/models";

export type PeopleDirectoryCategory = "employees" | "staff" | "managers" | "department heads" | "operators" | "service workers";

export type ImportValidationResult = {
  allowed: boolean;
  duplicateState: DuplicateState;
  issues: string[];
  normalized: BulkImportCandidate;
};

const IMPORT_FIELD_ALIASES: Record<string, string[]> = {
  institutionEmployeeId: ["institution employee id", "employee id", "institution id", "employee_number"],
  fullName: ["full name", "full_name", "employee name", "name"],
  officialEmail: ["official email", "email", "work email", "email address", "email_address"],
  phone: ["phone", "phone number", "mobile", "mobile phone", "telephone"],
  department: ["department", "department name", "team", "unit"],
  role: ["role", "access role", "position type"],
  position: ["position", "job title", "title"],
  employmentType: ["employment type", "employment_type", "contract type"],
  status: ["status", "employee status", "account status"],
};

export function normalizeImportCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

export function mapBulkImportRow(rawRow: Record<string, unknown>, existing: BulkImportCandidate[] = []) {
  const lookup = new Map<string, string>();
  Object.entries(rawRow).forEach(([key, value]) => {
    lookup.set(String(key).trim().toLowerCase(), normalizeImportCell(value));
  });

  const getCell = (field: keyof typeof IMPORT_FIELD_ALIASES) => {
    const aliases = IMPORT_FIELD_ALIASES[field] ?? [field];
    for (const alias of aliases) {
      const resolved = lookup.get(alias.toLowerCase()) ?? lookup.get(alias.toLowerCase().replace(/\s+/g, "_"));
      if (resolved !== undefined && resolved !== "") return resolved;
    }
    for (const [key, value] of lookup) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (aliases.some((alias) => normalizedKey === alias.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
        return value;
      }
    }
    return "";
  };

  const candidate: BulkImportCandidate = {
    rowId: `row-${Math.random().toString(36).slice(2, 9)}`,
    institutionEmployeeId: getCell("institutionEmployeeId"),
    fullName: getCell("fullName"),
    officialEmail: getCell("officialEmail"),
    phone: getCell("phone"),
    department: getCell("department"),
    role: getCell("role"),
    position: getCell("position"),
    employmentType: getCell("employmentType"),
    status: getCell("status") || "active",
    duplicateState: "New",
    issues: [],
  };

  const validation = validateBulkImportRow(candidate, existing);
  return validation;
}

export function buildImportPreview(rows: Record<string, unknown>[], existing: BulkImportCandidate[] = []) {
  return rows.map((rawRow) => {
    const result = mapBulkImportRow(rawRow, existing);
    return {
      ...result.normalized,
      duplicateState: result.duplicateState,
      issues: result.issues,
      allowed: result.allowed,
    };
  });
}

export function generateInstitutionBoundEmployeeId(institutionId: string, fullName: string, existingIds: string[] = []) {
  const base = `${institutionId.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)}-${fullName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8)}`;
  const unique = `${base}-${(existingIds.filter(Boolean).length + 1).toString().padStart(4, "0")}`;
  return unique;
}

export function assessDuplicateState(candidate: Pick<BulkImportCandidate, "institutionEmployeeId" | "fullName" | "officialEmail" | "phone" | "department" | "role">, existing: BulkImportCandidate[]) {
  if (!candidate.institutionEmployeeId && !candidate.officialEmail && !candidate.phone) return "Missing Identifier" as DuplicateState;
  const exactEmail = existing.find((item) => item.officialEmail && item.officialEmail.toLowerCase() === candidate.officialEmail?.toLowerCase());
  const phoneNormalized = candidate.phone ? candidate.phone.replace(/\D/g, "") : null;
  const exactPhone = phoneNormalized ? existing.find((item) => item.phone && item.phone.replace(/\D/g, "") === phoneNormalized) : null;
  const sameEmployeeId = candidate.institutionEmployeeId ? existing.find((item) => item.institutionEmployeeId === candidate.institutionEmployeeId) : null;
  if (sameEmployeeId || exactEmail || exactPhone) return "Existing Match" as DuplicateState;
  const nameChance = existing.filter((item) => item.fullName && item.fullName.toLowerCase() === candidate.fullName.toLowerCase()).length;
  if (nameChance > 0 && candidate.department && candidate.role) return "Possible Duplicate" as DuplicateState;
  if (candidate.department && candidate.role && (!candidate.institutionEmployeeId || !candidate.officialEmail)) return "Needs Review" as DuplicateState;
  return "New" as DuplicateState;
}

export function validateBulkImportRow(candidate: BulkImportCandidate, existing: BulkImportCandidate[]): ImportValidationResult {
  const normalized: BulkImportCandidate = {
    ...candidate,
    rowId: candidate.rowId || `row-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    fullName: candidate.fullName?.trim() ?? "",
    officialEmail: candidate.officialEmail?.trim() ?? "",
    phone: candidate.phone?.trim() ?? "",
    department: candidate.department?.trim() ?? "",
    role: candidate.role?.trim() ?? "",
    position: candidate.position?.trim() ?? "",
    employmentType: candidate.employmentType?.trim() ?? "",
    status: candidate.status?.trim() ?? "active",
    issues: [],
  };

  const issues: string[] = [];
  if (!normalized.fullName) issues.push("Full name is required");
  if (!normalized.officialEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.officialEmail)) issues.push("Official email is invalid");
  if (!normalized.department) issues.push("Department is required");
  if (!normalized.role) issues.push("Role is required");

  const duplicateState = assessDuplicateState(normalized, existing);
  if (duplicateState === "Conflict" || duplicateState === "Needs Review") issues.push("Manual review required");
  if (normalized.officialEmail.toLowerCase().includes("<script") || normalized.fullName.toLowerCase().includes("<script")) {
    issues.push("Malicious content detected");
  }

  return {
    allowed: issues.length === 0,
    duplicateState,
    issues,
    normalized,
  };
}

export function createOperationalAccessProfile(input: Pick<OperationalAccessProfile, "terminalId" | "institutionId" | "label" | "scope" | "allowedPages" | "allowedActions" | "departmentScope" | "moduleScope" | "sessionMinutes" | "autoLockSeconds" | "requiresReauthForSensitiveActions">): OperationalAccessProfile {
  return {
    terminalId: input.terminalId,
    institutionId: input.institutionId,
    label: input.label,
    scope: input.scope,
    allowedPages: input.allowedPages,
    allowedActions: input.allowedActions,
    departmentScope: input.departmentScope,
    moduleScope: input.moduleScope,
    sessionMinutes: input.sessionMinutes ?? 120,
    autoLockSeconds: input.autoLockSeconds ?? 300,
    requiresReauthForSensitiveActions: input.requiresReauthForSensitiveActions ?? true,
    status: "active",
    createdAt: new Date().toISOString(),
  };
}

export function validateTerminalAccess(profile: OperationalAccessProfile, page: string, action: string, departmentId: string | null, module: string) {
  const pageAccess = profile.allowedPages.includes(page) || profile.allowedPages.includes("*");
  const actionAccess = profile.allowedActions.includes(action) || profile.allowedActions.includes("*");
  const departmentAccess = profile.departmentScope.length === 0 || profile.departmentScope.includes("*") || (departmentId ? profile.departmentScope.includes(departmentId) : false);
  const moduleAccess = profile.moduleScope.length === 0 || profile.moduleScope.includes("*") || profile.moduleScope.includes(module);
  const isRevoked = profile.status === "revoked";

  return {
    allowed: !isRevoked && pageAccess && actionAccess && departmentAccess && moduleAccess,
    reason: isRevoked ? "Terminal revoked" : !pageAccess ? "Page not permitted" : !actionAccess ? "Action not permitted" : !departmentAccess ? "Department not permitted" : !moduleAccess ? "Module not permitted" : "allowed",
  };
}

export function createPeopleDirectoryEntry(input: { institutionId: string; fullName: string; email: string; phone?: string; departmentId?: string | null; role: WorkforceRole; position?: string; employmentType?: string; status?: "active" | "inactive"; existingIds?: string[] }) {
  const nextEmployeeId = generateInstitutionBoundEmployeeId(input.institutionId, input.fullName, input.existingIds ?? []);
  return {
    institutionEmployeeId: nextEmployeeId,
    institutionId: input.institutionId,
    fullName: input.fullName,
    officialEmail: input.email,
    phone: input.phone ?? "",
    department: input.departmentId ?? "unassigned",
    role: input.role,
    position: input.position ?? "",
    employmentType: input.employmentType ?? "full_time",
    status: input.status ?? "active",
  };
}
