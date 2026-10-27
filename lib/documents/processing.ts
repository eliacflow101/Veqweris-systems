export type DocumentProcessingStatus = "VALIDATED" | "EXTRACTED" | "NEEDS_REVIEW" | "UNSUPPORTED" | "REJECTED" | "FAILED";

export type ProcessingInput = {
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  scanStatus: "CLEAN";
};

export type ProcessingResult = {
  status: DocumentProcessingStatus;
  extractedText: string | null;
  reason: string;
  metadata: {
    scanned: boolean;
    ocrAvailable: boolean;
    supported: boolean;
  };
};

const blockedExtensions = [
  ".exe",
  ".dll",
  ".bat",
  ".cmd",
  ".scr",
  ".js",
  ".jar",
  ".ps1",
  ".sh",
  ".msi",
  ".apk",
  ".app",
  ".dmg",
];

const supportedMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
  "application/json",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

function isBlockedByExtension(fileName: string) {
  const lower = fileName.toLowerCase();
  return blockedExtensions.some((extension) => lower.endsWith(extension));
}

function isSupportedDocument(fileName: string, mimeType: string) {
  const lowerName = fileName.toLowerCase();
  const supportedByMime = supportedMimeTypes.includes(mimeType.toLowerCase());
  const supportedByExtension =
    lowerName.endsWith(".pdf") ||
    lowerName.endsWith(".png") ||
    lowerName.endsWith(".jpg") ||
    lowerName.endsWith(".jpeg") ||
    lowerName.endsWith(".gif") ||
    lowerName.endsWith(".webp") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".doc") ||
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".xls") ||
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".ppt") ||
    lowerName.endsWith(".pptx") ||
    lowerName.endsWith(".rtf");
  return supportedByMime || supportedByExtension;
}

export async function runDocumentProcessingPipeline(input: ProcessingInput): Promise<ProcessingResult> {
  const { fileName, mimeType, size, storagePath } = input;
  const normalizedMime = (mimeType || "").toLowerCase();

  if (input.scanStatus !== "CLEAN") {
    return {
      status: "FAILED",
      extractedText: null,
      reason: "The file has no verified clean scanner verdict and must remain quarantined.",
      metadata: { scanned: false, ocrAvailable: false, supported: false },
    };
  }

  if (!fileName || !storagePath) {
    return {
      status: "REJECTED",
      extractedText: null,
      reason: "Document metadata is incomplete and cannot be validated.",
      metadata: { scanned: true, ocrAvailable: false, supported: false },
    };
  }

  if (isBlockedByExtension(fileName)) {
    return {
      status: "REJECTED",
      extractedText: null,
      reason: "Executable or unsafe file types are blocked by the threat-scan policy.",
      metadata: { scanned: true, ocrAvailable: false, supported: false },
    };
  }

  if (size <= 0) {
    return {
      status: "REJECTED",
      extractedText: null,
      reason: "Document content is empty and cannot be accepted.",
      metadata: { scanned: true, ocrAvailable: false, supported: false },
    };
  }

  const supported = isSupportedDocument(fileName, normalizedMime);
  if (!supported) {
    return {
      status: "UNSUPPORTED",
      extractedText: null,
      reason: "This file type is not supported by the current document processing pipeline.",
      metadata: { scanned: true, ocrAvailable: false, supported: false },
    };
  }

  if (size > 25 * 1024 * 1024) {
    return {
      status: "NEEDS_REVIEW",
      extractedText: null,
      reason: "The document exceeds the standard processing threshold and requires an operator review.",
      metadata: { scanned: true, ocrAvailable: false, supported: true },
    };
  }

  return {
    status: "VALIDATED",
    extractedText: null,
    reason: "A verified clean scanner verdict was recorded. Content extraction is not configured.",
    metadata: { scanned: true, ocrAvailable: false, supported: true },
  };
}
