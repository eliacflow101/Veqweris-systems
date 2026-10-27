export type DocumentRecordStatus =
  | "UPLOADED"
  | "QUEUED"
  | "PROCESSING"
  | "EXTRACTED"
  | "NEEDS_REVIEW"
  | "VALIDATED"
  | "VERIFIED"
  | "AVAILABLE"
  | "FAILED"
  | "UNSUPPORTED"
  | "REJECTED";

export type DocumentScanStatus = "UPLOADED_QUARANTINED" | "SCANNING" | "CLEAN" | "INFECTED" | "SCAN_FAILED" | "UNKNOWN";

export type DocumentMetadata = {
  documentId: string;
  name: string;
  mimeType: string;
  size: number;
  status: DocumentRecordStatus;
  scanStatus: DocumentScanStatus;
  scanReason: string | null;
  departmentId: string | null;
  createdAt: string | null;
  uploadedAt: string | null;
  updatedAt: string | null;
};
