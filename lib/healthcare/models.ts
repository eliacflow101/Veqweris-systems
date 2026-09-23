export type HealthcareSensitivity = "standard" | "sensitive" | "highly_sensitive";
export type HealthcareRecordKind = "patient" | "encounter" | "service" | "clinical" | "billing" | "document";

export interface HealthcareWorkspaceProfile {
  institutionId: string;
  name?: string;
  baseCurrency?: string;
  configured: boolean;
  createdAt: unknown;
  updatedAt: unknown;
}

/** Identity is deliberately independent from clinical and financial records. */
export interface PatientIdentity {
  patientId: string;
  institutionId: string;
  patientNumber: string;
  fullName: string;
  dateOfBirth?: string | null;
  sex?: string | null;
  phone?: string | null;
  status: "active" | "inactive" | "deceased";
  createdAt: unknown;
}

export interface HealthcareEncounter {
  encounterId: string;
  institutionId: string;
  patientId: string;
  encounterType: "outpatient" | "inpatient" | "emergency" | "telehealth" | "follow_up";
  status: "planned" | "open" | "closed" | "cancelled";
  departmentId?: string | null;
  practitionerId?: string | null;
  startedAt?: unknown;
  endedAt?: unknown;
  createdAt: unknown;
}

export interface HealthcareService {
  serviceId: string;
  institutionId: string;
  code: string;
  name: string;
  category: string;
  price?: number | null;
  currency?: string | null;
  active: boolean;
  createdAt: unknown;
}

export interface ClinicalRecord {
  clinicalRecordId: string;
  institutionId: string;
  patientId: string;
  encounterId: string;
  recordType: "observation" | "diagnosis" | "procedure" | "prescription" | "note";
  summary: string;
  sensitivity: HealthcareSensitivity;
  authoredBy: string;
  createdAt: unknown;
}

export interface BillingReference {
  billingReferenceId: string;
  institutionId: string;
  patientId: string;
  encounterId?: string | null;
  serviceId?: string | null;
  paymentReference?: string | null;
  amount?: number | null;
  currency?: string | null;
  status: "unbilled" | "pending" | "paid" | "void";
  createdAt: unknown;
}

export interface HealthcareDocument {
  healthcareDocumentId: string;
  institutionId: string;
  patientId: string;
  encounterId?: string | null;
  documentId: string;
  documentType: "referral" | "result" | "consent" | "insurance" | "other";
  sensitivity: HealthcareSensitivity;
  createdAt: unknown;
}

export type LaboratoryRequestStatus = "requested" | "authorized" | "sample_collected" | "processing" | "result_entered" | "verified" | "released" | "cancelled";

export interface LaboratoryRequest {
  laboratoryRequestId: string;
  institutionId: string;
  patientId: string;
  encounterId?: string | null;
  serviceId?: string | null;
  requestedBy: string;
  status: LaboratoryRequestStatus;
  sensitivity: HealthcareSensitivity;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface LaboratorySample {
  sampleId: string;
  laboratoryRequestId: string;
  institutionId: string;
  patientId: string;
  specimenType: string;
  accessionNumber: string;
  status: "collected" | "received" | "processing" | "processed" | "rejected";
  collectedBy: string;
  collectedAt: unknown;
  updatedAt: unknown;
}

export interface LaboratoryResult {
  laboratoryResultId: string;
  laboratoryRequestId: string;
  sampleId: string;
  institutionId: string;
  patientId: string;
  values: Record<string, string | number | boolean>;
  enteredBy: string;
  verifiedBy?: string | null;
  releasedBy?: string | null;
  status: "draft" | "entered" | "verified" | "released";
  sensitivity: HealthcareSensitivity;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PharmacyMedicine {
  medicineId: string;
  institutionId: string;
  name: string;
  form: string;
  strength: string;
  inventoryItemId: string;
  active: boolean;
  createdAt: unknown;
}

export interface PharmacyBatch {
  batchId: string;
  medicineId: string;
  institutionId: string;
  batchNumber: string;
  expiryDate: string;
  inventoryItemId: string;
  status: "available" | "quarantined" | "expired" | "recalled";
  receivedAt: unknown;
}

export interface PharmacyDispense {
  dispenseId: string;
  institutionId: string;
  medicineId: string;
  batchId: string;
  inventoryMovementId: string;
  patientId: string;
  prescriptionReference?: string | null;
  quantity: number;
  sensitivity: HealthcareSensitivity;
  dispensedBy: string;
  status: "requested" | "approved" | "dispensed" | "returned" | "cancelled";
  createdAt: unknown;
  updatedAt: unknown;
}

export interface HealthcareQueueEntry {
  queueEntryId: string;
  institutionId: string;
  patientId: string;
  encounterId?: string | null;
  departmentId?: string | null;
  servicePointId?: string | null;
  serviceId?: string | null;
  status: "waiting" | "in_service" | "completed" | "cancelled";
  priority: "routine" | "priority" | "urgent";
  createdAt: unknown;
}

export interface HealthcareServicePoint {
  servicePointId: string;
  institutionId: string;
  name: string;
  departmentId?: string | null;
  queueMode: "single" | "batch";
  active: boolean;
  createdAt: unknown;
}

export interface HealthcareResource {
  resourceId: string;
  institutionId: string;
  resourceType: "bed" | "room" | "equipment" | "staff" | "service_point" | "operating_room" | "diagnostic_equipment";
  name: string;
  departmentId?: string | null;
  available: boolean;
  capacity?: number | null;
  createdAt: unknown;
}
