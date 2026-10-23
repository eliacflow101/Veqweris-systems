import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EmployeeImportCsvError,
  MAX_EMPLOYEE_IMPORT_BYTES,
  MAX_EMPLOYEE_IMPORT_ROWS,
  parseEmployeeImportCsv,
} from "../lib/employee-import/csv";
import { buildImportPreview } from "../lib/people-engine";

const validCsv = [
  "Full Name,Email,Department,Role",
  "Alex Morgan,alex@example.test,Operations,Employee",
].join("\n");

describe("employee import CSV parsing", () => {
  it("parses UTF-8 CSV rows and retains supported header names", () => {
    assert.deepEqual(parseEmployeeImportCsv(Buffer.from(validCsv)), [{
      "Full Name": "Alex Morgan",
      Email: "alex@example.test",
      Department: "Operations",
      Role: "Employee",
    }]);
  });

  it("rejects workbook formats even when uploaded with a CSV extension", () => {
    assert.throws(
      () => parseEmployeeImportCsv(Buffer.from("PK\u0003\u0004workbook")),
      (error: unknown) => error instanceof EmployeeImportCsvError && error.code === "invalid",
    );
    assert.throws(
      () => parseEmployeeImportCsv(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
      (error: unknown) => error instanceof EmployeeImportCsvError && error.code === "invalid",
    );
  });

  it("rejects malformed CSV, invalid UTF-8, and repeated or empty headers", () => {
    for (const input of [
      "name,email\nAlex",
      "name,email\nAlex,\"unfinished",
      "name,email,Email\nAlex,alex@example.test,other@example.test",
      "name,,role\nAlex,alex@example.test,Employee",
    ]) {
      assert.throws(
        () => parseEmployeeImportCsv(Buffer.from(input)),
        (error: unknown) => error instanceof EmployeeImportCsvError && error.code === "invalid",
      );
    }
    assert.throws(
      () => parseEmployeeImportCsv(Buffer.from([0xff, 0xfe, 0xfd])),
      (error: unknown) => error instanceof EmployeeImportCsvError && error.code === "invalid",
    );
  });

  it("rejects empty, oversized, and over-limit row inputs", () => {
    assert.throws(
      () => parseEmployeeImportCsv(Buffer.alloc(0)),
      (error: unknown) => error instanceof EmployeeImportCsvError && error.code === "empty",
    );
    assert.throws(
      () => parseEmployeeImportCsv(Buffer.alloc(MAX_EMPLOYEE_IMPORT_BYTES + 1)),
      (error: unknown) => error instanceof EmployeeImportCsvError && error.code === "too-large",
    );

    const manyRows = `name,email\n${Array.from(
      { length: MAX_EMPLOYEE_IMPORT_ROWS + 1 },
      (_, index) => `Employee ${index},employee-${index}@example.test`,
    ).join("\n")}`;
    assert.throws(
      () => parseEmployeeImportCsv(Buffer.from(manyRows)),
      (error: unknown) => error instanceof EmployeeImportCsvError && error.code === "too-many-rows",
    );
  });

  it("keeps required-field validation and existing-record duplicate detection", () => {
    const preview = buildImportPreview(parseEmployeeImportCsv(Buffer.from([
      "Full Name,Email,Department,Role",
      ",invalid-email,,",
      "Alex Morgan,alex@example.test,Operations,Employee",
    ].join("\n"))), [{
      rowId: "existing",
      institutionEmployeeId: "",
      fullName: "Alex Morgan",
      officialEmail: "alex@example.test",
      phone: "",
      department: "Operations",
      role: "Employee",
    }]);

    assert.equal(preview[0].allowed, false);
    assert.ok(preview[0].issues.includes("Full name is required"));
    assert.ok(preview[0].issues.includes("Official email is invalid"));
    assert.equal(preview[1].duplicateState, "Existing Match");
  });
});
