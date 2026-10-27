import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  createConfiguredScannerAdapter,
  scanDocumentBytes,
  scanQuarantinedDocument,
  validateDocumentMagicBytes,
  type FileScannerAdapter,
} from "../lib/documents/scanner";

const bytes = Buffer.from("non-sensitive scanner fixture");
const digest = createHash("sha256").update(bytes).digest("hex");

test("scanner absence fails closed and never produces a clean verdict", async () => {
  const result = await scanDocumentBytes({ bytes, mimeType: "text/plain" }, null);
  assert.equal(result.status, "UNAVAILABLE");
});

test("quarantined scan rejects a storage path outside the tenant quarantine", async () => {
  const result = await scanQuarantinedDocument({
    institutionId: "institution-a",
    storagePath: "documents/institution-a/file.txt",
    mimeType: "text/plain",
  }, null);
  assert.equal(result.status, "FAILED");
});

test("scanner clean verdict is accepted only when its digest matches the bytes", async () => {
  const adapter: FileScannerAdapter = {
    async scan(input) {
      assert.equal(input.sha256, digest);
      return { verdict: "clean", scanId: "scan-fixture-1", sha256: digest };
    },
  };
  const result = await scanDocumentBytes({ bytes, mimeType: "text/plain" }, adapter);
  assert.equal(result.status, "CLEAN");
  if (result.status === "CLEAN") assert.equal(result.sha256, digest);
});

test("scanner cannot bless a different byte sequence or malformed response", async () => {
  const mismatch: FileScannerAdapter = {
    async scan() { return { verdict: "clean", scanId: "scan-fixture-2", sha256: "0".repeat(64) }; },
  };
  const malformed: FileScannerAdapter = {
    async scan() { return { verdict: "clean", scanId: "", sha256: digest }; },
  };
  assert.equal((await scanDocumentBytes({ bytes, mimeType: "text/plain" }, mismatch)).status, "FAILED");
  assert.equal((await scanDocumentBytes({ bytes, mimeType: "text/plain" }, malformed)).status, "FAILED");
});

test("infected verdict remains quarantined", async () => {
  const adapter: FileScannerAdapter = {
    async scan(input) { return { verdict: "infected", scanId: "scan-fixture-3", sha256: input.sha256 }; },
  };
  const result = await scanDocumentBytes({ bytes, mimeType: "text/plain" }, adapter);
  assert.equal(result.status, "INFECTED");
});

test("configured scanner requires a complete HTTPS endpoint and credential", () => {
  assert.equal(createConfiguredScannerAdapter({}), null);
  assert.throws(() => createConfiguredScannerAdapter({ FILE_SCANNER_URL: "https://scanner.example.test" }), /must both be configured/);
  assert.throws(() => createConfiguredScannerAdapter({
    FILE_SCANNER_URL: "http://scanner.example.test",
    FILE_SCANNER_BEARER_TOKEN: "test-secret",
  }), /must use HTTPS/);
  assert.ok(createConfiguredScannerAdapter({
    FILE_SCANNER_URL: "https://scanner.example.test/scan",
    FILE_SCANNER_BEARER_TOKEN: "test-secret",
  }));
});

test("upload type validation requires matching file signatures", () => {
  assert.equal(validateDocumentMagicBytes(Buffer.from("%PDF-1.7\n"), "application/pdf"), true);
  assert.equal(validateDocumentMagicBytes(Buffer.from("not a PDF"), "application/pdf"), false);
  assert.equal(validateDocumentMagicBytes(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "image/png",
  ), true);
  assert.equal(validateDocumentMagicBytes(Buffer.from("GIF89a"), "image/png"), false);
});
