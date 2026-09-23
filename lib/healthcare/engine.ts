import type { HealthcareRecordKind, HealthcareSensitivity } from "./models";
import type { LaboratoryRequestStatus, LaboratoryResult } from "./models";
import type { UserRole } from "@/lib/firebase/models";

export type HealthcareRole = Extract<UserRole, "Owner" | "Admin" | "Manager" | "Employee" | "Clinician" | "Nurse" | "Reception" | "Billing" | "Laboratory" | "Pharmacist">;

export interface HealthcareAccessInput {
  role: string;
  recordKind: HealthcareRecordKind;
  sensitivity?: HealthcareSensitivity;
  moduleEnabled: boolean;
  hasSensitivePermission?: boolean;
  departmentId?: string | null;
  recordDepartmentId?: string | null;
  specialtyId?: string | null;
  recordSpecialtyId?: string | null;
  patientId?: string | null;
  assignedPatientIds?: string[];
}

const roleKinds: Record<HealthcareRole, HealthcareRecordKind[]> = {
  Owner: ["patient", "encounter", "service", "clinical", "billing", "document"],
  Admin: ["patient", "encounter", "service", "billing", "document"],
  Manager: ["patient", "encounter", "service", "billing", "document"],
  Employee: [],
  Clinician: ["patient", "encounter", "service", "clinical", "document"],
  Nurse: ["patient", "encounter", "clinical", "document"],
  Reception: ["patient", "encounter", "service"],
  Billing: ["patient", "encounter", "service", "billing"],
  Laboratory: ["patient", "encounter", "service", "clinical", "document"],
  Pharmacist: ["patient", "encounter", "service", "billing", "document"],
};

export function getHealthcareScope(role: string): { role: string; recordKinds: HealthcareRecordKind[]; scope: "institution" | "department" | "assigned" | "none" } {
  const kinds = roleKinds[role as HealthcareRole] ?? [];
  const scope = role === "Clinician" || role === "Nurse" ? "assigned" : role === "Manager" ? "department" : kinds.length ? "institution" : "none";
  return { role, recordKinds: [...kinds], scope };
}

export function canAccessHealthcareRecord(input: HealthcareAccessInput) {
  if (!input.moduleEnabled) return { allowed: false, reason: "Healthcare module is not enabled." };
  const scope = getHealthcareScope(input.role);
  if (!scope.recordKinds.includes(input.recordKind)) return { allowed: false, reason: "Role is not permitted to access this record type." };
  if (input.sensitivity !== "standard" && !input.hasSensitivePermission) return { allowed: false, reason: "Sensitive healthcare permission is required." };
  if (scope.scope === "department" && input.departmentId !== input.recordDepartmentId) return { allowed: false, reason: "Record is outside the user's department scope." };
  if (scope.scope === "assigned" && (!input.patientId || !input.assignedPatientIds?.includes(input.patientId))) return { allowed: false, reason: "Patient is not assigned to the user." };
  if (input.recordSpecialtyId && input.specialtyId !== input.recordSpecialtyId) return { allowed: false, reason: "Record is outside the user's specialty scope." };
  return { allowed: true, reason: "Healthcare record access is allowed." };
}

export function generateHealthcarePatientNumber(institutionId: string, sequenceNo = 1) {
  const compact = (institutionId || "INST").replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "INST";
  const seed = Math.abs((compact.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) + sequenceNo * 97) % 900000 + 100000);
  return `PT-${compact}-${String(seed)}`;
}

export function buildHealthcareDashboardMetrics(input: {
  patients: Array<{ status?: string }>; 
  encounters: Array<{ status?: string }>; 
  services: Array<{ active?: boolean }>; 
  queueEntries: Array<{ status?: string }>; 
  billing: Array<{ status?: string }>; 
  clinicalRecords: Array<{ sensitivity?: string }>; 
  resources: Array<{ available?: boolean }>; 
}) {
  const activePatients = input.patients.filter((patient) => patient.status === "active").length;
  const openEncounters = input.encounters.filter((encounter) => ["planned", "open"].includes(encounter.status ?? "")).length;
  const waitingQueue = input.queueEntries.filter((entry) => entry.status === "waiting").length;
  const activeServices = input.services.filter((service) => service.active !== false).length;
  const paidBilling = input.billing.filter((item) => item.status === "paid").length;
  const sensitiveClinical = input.clinicalRecords.filter((item) => item.sensitivity === "sensitive" || item.sensitivity === "highly_sensitive").length;
  const readyResources = input.resources.filter((resource) => resource.available !== false).length;

  return {
    activePatients,
    openEncounters,
    waitingQueue,
    activeServices,
    paidBilling,
    sensitiveClinical,
    readyResources,
    totalResources: input.resources.length,
    utilization: input.resources.length ? Math.round((readyResources / input.resources.length) * 100) : 0,
  };
}

export function calculateHealthcareReadiness(input: {
  institutionConfigured: boolean;
  profileConfigured: boolean;
  patientIdentityConfigured: boolean;
  encountersConfigured: boolean;
  servicesConfigured: boolean;
  clinicalAccessConfigured: boolean;
  billingIntegrationConfigured: boolean;
  documentsConfigured: boolean;
}) {
  const checks = [
    ["Institution configured", input.institutionConfigured],
    ["Healthcare profile configured", input.profileConfigured],
    ["Patient identity configured", input.patientIdentityConfigured],
    ["Encounter workflow configured", input.encountersConfigured],
    ["Services configured", input.servicesConfigured],
    ["Clinical access configured", input.clinicalAccessConfigured],
    ["Billing integration configured", input.billingIntegrationConfigured],
    ["Documents configured", input.documentsConfigured],
  ] as const;
  const missing = checks.filter(([, ready]) => !ready).map(([label]) => label);
  return { ready: missing.length === 0, completed: checks.length - missing.length, total: checks.length, missing };
}

const laboratoryTransitions: Record<LaboratoryRequestStatus, LaboratoryRequestStatus[]> = {
  requested: ["authorized", "cancelled"],
  authorized: ["sample_collected", "cancelled"],
  sample_collected: ["processing", "cancelled"],
  processing: ["result_entered", "cancelled"],
  result_entered: ["verified", "processing"],
  verified: ["released"],
  released: [],
  cancelled: [],
};

export function canTransitionLaboratoryRequest(from: LaboratoryRequestStatus, to: LaboratoryRequestStatus) {
  return laboratoryTransitions[from].includes(to);
}

export function canReleaseLaboratoryResult(result: Pick<LaboratoryResult, "status" | "verifiedBy">) {
  return result.status === "verified" && Boolean(result.verifiedBy);
}
