export const SYSTEM_TIERS = ["Employee", "Manager", "Admin", "Owner"] as const;
export type SystemTier = typeof SYSTEM_TIERS[number];

export const SENSITIVITY_CLASSES = ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
export type SensitivityClass = typeof SENSITIVITY_CLASSES[number];
export type ScopeDimension = "location" | "unit" | "department" | "team" | "academic";

export type PermissionScope = {
  institutionId?: string;
  locationIds?: string[];
  unitIds?: string[];
  departmentIds?: string[];
  teamIds?: string[];
  academic?: {
    levels?: string[];
    classes?: string[];
    streams?: string[];
    subjects?: string[];
  };
  ownRecordsOnly?: boolean;
  recordOwnerUid?: string;
  sensitivityCeiling?: SensitivityClass;
};

export type PermissionDefinition = {
  key: string;
  label: string;
  module: string;
  sensitivity: SensitivityClass;
  dimensions: ScopeDimension[];
  dangerous: boolean;
  lowestTier: SystemTier;
};

const permissionDefinitions: PermissionDefinition[] = [
  { key: "dashboard.summary.read", label: "View dashboard summaries", module: "dashboard", sensitivity: "INTERNAL", dimensions: [], dangerous: false, lowestTier: "Employee" },
  { key: "departments.read", label: "View departments", module: "departments", sensitivity: "INTERNAL", dimensions: ["location", "unit", "department"], dangerous: false, lowestTier: "Employee" },
  { key: "departments.manage", label: "Manage departments", module: "departments", sensitivity: "CONFIDENTIAL", dimensions: ["location", "unit", "department"], dangerous: false, lowestTier: "Admin" },
  { key: "employees.read", label: "View employee directory", module: "employees", sensitivity: "CONFIDENTIAL", dimensions: ["location", "unit", "department", "team"], dangerous: false, lowestTier: "Employee" },
  { key: "employees.invite", label: "Invite employees", module: "employees", sensitivity: "CONFIDENTIAL", dimensions: ["location", "unit", "department"], dangerous: true, lowestTier: "Admin" },
  { key: "employees.access.manage", label: "Manage employee access", module: "employees", sensitivity: "RESTRICTED", dimensions: ["location", "unit", "department", "team"], dangerous: true, lowestTier: "Admin" },
  { key: "tasks.read", label: "View tasks", module: "tasks", sensitivity: "INTERNAL", dimensions: ["location", "unit", "department", "team"], dangerous: false, lowestTier: "Employee" },
  { key: "tasks.manage", label: "Manage tasks", module: "tasks", sensitivity: "INTERNAL", dimensions: ["location", "unit", "department", "team"], dangerous: false, lowestTier: "Manager" },
  { key: "inventory.stock.read", label: "View stock", module: "inventory", sensitivity: "CONFIDENTIAL", dimensions: ["location", "unit", "department"], dangerous: false, lowestTier: "Employee" },
  { key: "inventory.stock.adjust", label: "Adjust stock", module: "inventory", sensitivity: "CONFIDENTIAL", dimensions: ["location", "unit", "department"], dangerous: true, lowestTier: "Manager" },
  { key: "finance.payment.read", label: "View payment details", module: "finance", sensitivity: "RESTRICTED", dimensions: ["location", "department"], dangerous: false, lowestTier: "Employee" },
  { key: "finance.payment.refund", label: "Refund payments", module: "finance", sensitivity: "RESTRICTED", dimensions: ["location", "department"], dangerous: true, lowestTier: "Admin" },
  { key: "health.record.read", label: "View health records", module: "healthcare", sensitivity: "RESTRICTED", dimensions: ["location", "unit", "department"], dangerous: false, lowestTier: "Employee" },
  { key: "school.students.read", label: "View student records", module: "school", sensitivity: "CONFIDENTIAL", dimensions: ["location", "unit", "department", "academic"], dangerous: false, lowestTier: "Employee" },
  { key: "school.safeguarding.read", label: "View safeguarding records", module: "school", sensitivity: "RESTRICTED", dimensions: ["location", "unit", "academic"], dangerous: true, lowestTier: "Employee" },
  { key: "organization.roles.manage", label: "Manage roles and permissions", module: "organization", sensitivity: "RESTRICTED", dimensions: [], dangerous: true, lowestTier: "Admin" },
  { key: "organization.memberships.manage", label: "Manage memberships and scopes", module: "organization", sensitivity: "RESTRICTED", dimensions: ["location", "unit", "department", "team"], dangerous: true, lowestTier: "Admin" },
  { key: "organization.locations.manage", label: "Manage locations", module: "organization", sensitivity: "CONFIDENTIAL", dimensions: ["location"], dangerous: false, lowestTier: "Admin" },
  { key: "organization.units.manage", label: "Manage operational units", module: "organization", sensitivity: "CONFIDENTIAL", dimensions: ["location", "unit"], dangerous: false, lowestTier: "Admin" },
  { key: "organization.teams.manage", label: "Manage teams", module: "organization", sensitivity: "CONFIDENTIAL", dimensions: ["location", "unit", "department", "team"], dangerous: false, lowestTier: "Manager" },
];

export const PERMISSION_REGISTRY: Readonly<Record<string, PermissionDefinition>> =
  Object.freeze(Object.fromEntries(permissionDefinitions.map((permission) => [permission.key, Object.freeze(permission)])));

export const SYSTEM_ROLE_TEMPLATES = [
  { templateId: "teacher", name: "Teacher", tier: "Employee", modules: ["school"], permissions: ["school.students.read"] },
  { templateId: "finance-officer", name: "Finance Officer", tier: "Employee", modules: ["finance"], permissions: ["finance.payment.read"] },
  { templateId: "admissions-officer", name: "Admissions Officer", tier: "Employee", modules: ["school"], permissions: ["school.students.read"] },
  { templateId: "librarian", name: "Librarian", tier: "Employee", modules: ["school"], permissions: ["school.students.read"] },
  { templateId: "transport-officer", name: "Transport Officer", tier: "Employee", modules: ["school"], permissions: ["school.students.read"] },
  { templateId: "warden", name: "Warden", tier: "Employee", modules: ["school"], permissions: ["school.students.read"] },
  { templateId: "storekeeper", name: "Storekeeper", tier: "Employee", modules: ["inventory"], permissions: ["inventory.stock.read", "inventory.stock.adjust"] },
  { templateId: "counselor", name: "Counselor", tier: "Employee", modules: ["school"], permissions: ["school.students.read", "school.safeguarding.read"] },
  { templateId: "cashier", name: "Cashier", tier: "Employee", modules: ["finance"], permissions: ["finance.payment.read"] },
  { templateId: "pos-operator", name: "POS Operator", tier: "Employee", modules: ["hospitality"], permissions: ["inventory.stock.read"] },
  { templateId: "kitchen-staff", name: "Kitchen Staff", tier: "Employee", modules: ["hospitality"], permissions: ["inventory.stock.read"] },
  { templateId: "housekeeping", name: "Housekeeping", tier: "Employee", modules: ["hospitality"], permissions: ["tasks.read"] },
  { templateId: "receptionist", name: "Receptionist", tier: "Employee", modules: ["hospitality"], permissions: ["employees.read"] },
  { templateId: "pharmacist", name: "Pharmacist", tier: "Employee", modules: ["healthcare"], permissions: ["health.record.read", "inventory.stock.read"] },
  { templateId: "nurse", name: "Nurse", tier: "Employee", modules: ["healthcare"], permissions: ["health.record.read"] },
  { templateId: "lab-technician", name: "Lab Technician", tier: "Employee", modules: ["healthcare"], permissions: ["health.record.read"] },
  { templateId: "doctor-clinician", name: "Doctor/Clinician", tier: "Employee", modules: ["healthcare"], permissions: ["health.record.read"] },
  { templateId: "procurement-officer", name: "Procurement Officer", tier: "Employee", modules: ["inventory"], permissions: ["inventory.stock.read"] },
  { templateId: "auditor", name: "Auditor", tier: "Employee", modules: ["finance", "governance"], permissions: ["finance.payment.read", "dashboard.summary.read"] },
  { templateId: "department-head", name: "Department Head", tier: "Manager", modules: ["departments", "tasks"], permissions: ["departments.read", "tasks.read", "tasks.manage"] },
] as const;

export function tierRank(tier: string): number {
  return SYSTEM_TIERS.indexOf(tier as SystemTier);
}

export function isSystemTier(value: unknown): value is SystemTier {
  return typeof value === "string" && SYSTEM_TIERS.includes(value as SystemTier);
}
