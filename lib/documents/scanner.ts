import { createHash } from "node:crypto";
import { adminStorage } from "@/lib/firebase/admin";

export type ScannerVerdict = {
  verdict: "clean" | "infected";
  scanId: string;
  sha256: string;
};

export type ScannerResult =
  | { status: "CLEAN"; scanId: string; sha256: string }
  | { status: "INFECTED"; scanId: string; sha256: string; reason: string }
  | { status: "UNAVAILABLE"; reason: string }
  | { status: "FAILED"; reason: string };

export interface FileScannerAdapter {
  scan(input: { bytes: Buffer; mimeType: string; sha256: string }): Promise<ScannerVerdict>;
}

export function createConfiguredScannerAdapter(
  env: { FILE_SCANNER_URL?: string; FILE_SCANNER_BEARER_TOKEN?: string } = {
    FILE_SCANNER_URL: process.env.FILE_SCANNER_URL,
    FILE_SCANNER_BEARER_TOKEN: process.env.FILE_SCANNER_BEARER_TOKEN,
  },
): FileScannerAdapter | null {
  const endpoint = env.FILE_SCANNER_URL?.trim();
  const bearerToken = env.FILE_SCANNER_BEARER_TOKEN?.trim();
  if (!endpoint && !bearerToken) return null;
  if (!endpoint || !bearerToken) throw new Error("File scanner URL and server credential must both be configured.");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("The file scanner endpoint must use HTTPS.");
  }
  return {
    async scan(input) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/octet-stream",
          "X-File-Mime-Type": input.mimeType,
          "X-File-SHA256": input.sha256,
        },
        body: new Uint8Array(input.bytes),
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`Scanner service returned HTTP ${response.status}.`);
      const body = await response.text();
      if (body.length > 4096) throw new Error("Scanner response exceeded the accepted size.");
      return JSON.parse(body) as ScannerVerdict;
    },
  };
}

export function validateDocumentMagicBytes(bytes: Buffer, mimeType: string): boolean {
  const startsWith = (...signature: number[]) => bytes.length >= signature.length
    && signature.every((value, index) => bytes[index] === value);
  switch (mimeType.toLowerCase()) {
    case "application/pdf":
      return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
    case "application/vnd.ms-excel":
      return startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return startsWith(0x50, 0x4b, 0x03, 0x04);
    case "image/png":
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return startsWith(0xff, 0xd8, 0xff);
    case "image/gif":
      return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
    case "image/webp":
      return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF"
        && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    case "text/csv":
    case "application/vnd.ms-excel-csv":
      return bytes.length > 0 && !bytes.includes(0);
    default:
      return false;
  }
}

function isValidVerdict(value: unknown): value is ScannerVerdict {
  if (!value || typeof value !== "object") return false;
  const verdict = value as Partial<ScannerVerdict>;
  return (verdict.verdict === "clean" || verdict.verdict === "infected")
    && typeof verdict.scanId === "string" && verdict.scanId.length > 0 && verdict.scanId.length <= 256
    && typeof verdict.sha256 === "string" && /^[a-f0-9]{64}$/i.test(verdict.sha256);
}

export async function scanDocumentBytes(
  input: { bytes: Buffer; mimeType: string },
  adapter: FileScannerAdapter | null,
): Promise<ScannerResult> {
  if (!adapter) return { status: "UNAVAILABLE", reason: "No approved file-scanner adapter is deployed." };
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  try {
    const verdict: unknown = await adapter.scan({ ...input, sha256 });
    if (!isValidVerdict(verdict) || verdict.sha256.toLowerCase() !== sha256) {
      return { status: "FAILED", reason: "The scanner response was invalid or did not match the uploaded bytes." };
    }
    return {
      ...(verdict.verdict === "clean"
        ? { status: "CLEAN" as const, scanId: verdict.scanId, sha256 }
        : { status: "INFECTED" as const, scanId: verdict.scanId, sha256, reason: "The scanner detected a threat; the file remains quarantined." }),
    };
  } catch (error) {
    console.error("Document scanner adapter failed.", error);
    return { status: "FAILED", reason: "The file scanner failed; the file remains quarantined." };
  }
}

export async function scanQuarantinedDocument(input: {
  institutionId: string;
  storagePath: string;
  mimeType: string;
}, adapter: FileScannerAdapter | null): Promise<ScannerResult> {
  if (!input.storagePath.startsWith(`quarantine/${input.institutionId}/`)) {
    return { status: "FAILED", reason: "The file is not stored in this institution's quarantine." };
  }
  if (!adapter) return { status: "UNAVAILABLE", reason: "No approved file-scanner adapter is deployed." };
  if (!adminStorage) return { status: "UNAVAILABLE", reason: "Firebase Storage is not configured." };

  try {
    const [bytes] = await adminStorage.bucket().file(input.storagePath).download();
    return scanDocumentBytes({ bytes, mimeType: input.mimeType }, adapter);
  } catch (error) {
    console.error("Unable to read a quarantined document for scanning.", error);
    return { status: "FAILED", reason: "The quarantined file could not be read for scanning." };
  }
}
