import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import {
  EmployeeImportCsvError,
  MAX_EMPLOYEE_IMPORT_BYTES,
  MAX_EMPLOYEE_IMPORT_ROWS,
  parseEmployeeImportCsv,
} from "../lib/employee-import/csv";
import { EmployeeImportError } from "../lib/employee-import/errors";
import {
  MAX_XLSX_EXPANDED_BYTES,
  MAX_XLSX_PARSE_TIME_MS,
  parseEmployeeImportXlsx,
} from "../lib/employee-import/xlsx";
import { buildImportPreview } from "../lib/people-engine";
import { makeCorruptZip, makeEmployeeXlsx } from "./helpers/employee-xlsx-fixture";

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

  describe("employee import XLSX parsing", () => {
    it("parses one worksheet, ignores blank rows, and preserves Unicode and text identifiers", async () => {
      const rows = await parseEmployeeImportXlsx(makeEmployeeXlsx({ sharedStrings: true }));
      assert.equal(rows.length, 2);
      assert.deepEqual(rows[0], {
        "Full Name": "Zoë Example",
        Email: "zoe@example.test",
        Department: "Operations",
        Role: "Employee",
        "Employee ID": "0000123",
        Phone: "001-234",
      });
      assert.equal(rows[1]["Full Name"], "李明");
      const preview = buildImportPreview(rows);
      assert.equal(preview[0].allowed, true);
    });

    it("parses inline strings and rejects formula cells without evaluating them", async () => {
      assert.equal((await parseEmployeeImportXlsx(makeEmployeeXlsx()))[1]["Full Name"], "李明");
      await assert.rejects(
        parseEmployeeImportXlsx(makeEmployeeXlsx({ formula: true })),
        (error: unknown) => error instanceof EmployeeImportError && error.code === "unsupported",
      );
    });

    it("rejects renamed non-workbooks, malformed ZIP/XML, multiple sheets, formulas, and numeric identifiers", async () => {
      for (const input of [
        Buffer.from("plain text renamed to xlsx"),
        Buffer.from(validCsv),
        makeCorruptZip(),
        makeEmployeeXlsx({ corruptCrc: true }),
        makeEmployeeXlsx({ malformedSheet: true }),
        makeEmployeeXlsx({ multipleSheets: true }),
        makeEmployeeXlsx({ numericIdentifier: true }),
        makeEmployeeXlsx({ worksheetPrefix: "<?xml version=\"1.0\" encoding=\"UTF-16\"?>" }),
        makeEmployeeXlsx({ worksheetPrefix: "<!DOCTYPE worksheet [<!ENTITY x \"boom\">]>" }),
      ]) {
        await assert.rejects(parseEmployeeImportXlsx(input), (error: unknown) => error instanceof EmployeeImportError);
      }
    });

    it("rejects duplicate or unsafe archive parts, external relationships, macros, malformed cells, and excessive XML elements", async () => {
      const malformedCell = makeEmployeeXlsx({
        worksheetXml: `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>1</v><v>2</v></c></row></sheetData></worksheet>`,
      });
      const excessiveElements = makeEmployeeXlsx({
        worksheetXml: `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${"<x/>".repeat(150_001)}${randomBytes(128 * 1024).toString("base64")}</worksheet>`,
      });
      const invalidWorkbooks = [
        {
          input: makeEmployeeXlsx({ extraEntries: [{ name: "xl/worksheets/sheet1.xml", contents: "<worksheet/>" }] }),
          code: "invalid",
        },
        {
          input: makeEmployeeXlsx({ extraEntries: [{ name: "xl/../xl/worksheets/sheet2.xml", contents: "<worksheet/>" }] }),
          code: "invalid",
        },
        { input: makeEmployeeXlsx({ externalRelationship: true }), code: "unsupported" },
        {
          input: makeEmployeeXlsx({ extraEntries: [{ name: "xl/vbaProject.bin", contents: "macro content" }] }),
          code: "unsupported",
        },
        { input: malformedCell, code: "invalid" },
        { input: excessiveElements, code: "too-large" },
      ];
      for (const { input, code } of invalidWorkbooks) {
        await assert.rejects(
          parseEmployeeImportXlsx(input),
          (error: unknown) => error instanceof EmployeeImportError && error.code === code,
        );
      }
    });

    it("rejects ambiguous headers, excessive columns, excessive rows, oversized files, and archives", async () => {
      const duplicateHeaders = makeEmployeeXlsx({
        rows: [["Full Name", "Name", "Email", "Department", "Role"], ["Alex", "Alex", "a@example.test", "Ops", "Employee"]],
      });
      await assert.rejects(parseEmployeeImportXlsx(duplicateHeaders), (error: unknown) => error instanceof EmployeeImportError && error.code === "invalid");

      const excessiveColumns = makeEmployeeXlsx({
        rows: [Array.from({ length: 65 }, (_, index) => `Column ${index}`), Array.from({ length: 65 }, () => "value")],
      });
      await assert.rejects(parseEmployeeImportXlsx(excessiveColumns), (error: unknown) => error instanceof EmployeeImportError && error.code === "too-many-columns");

      const excessiveRows = makeEmployeeXlsx({
        rows: [
          ["Full Name", "Email", "Department", "Role"],
          ...Array.from({ length: MAX_EMPLOYEE_IMPORT_ROWS + 1 }, (_, index) => [`Employee ${index}`, `employee-${index}@example.test`, "Ops", "Employee"]),
        ],
      });
      await assert.rejects(parseEmployeeImportXlsx(excessiveRows), (error: unknown) => error instanceof EmployeeImportError && error.code === "too-many-rows");
      await assert.rejects(
        parseEmployeeImportXlsx(Buffer.alloc(MAX_EMPLOYEE_IMPORT_BYTES + 1)),
        (error: unknown) => error instanceof EmployeeImportError && error.code === "too-large",
      );
      const excessiveEntries = makeEmployeeXlsx({
        extraEntries: Array.from({ length: 60 }, (_, index) => ({ name: `folder-${index}/`, contents: "" })),
      });
      await assert.rejects(parseEmployeeImportXlsx(excessiveEntries), (error: unknown) => error instanceof EmployeeImportError && error.code === "too-large");
      const excessiveCompression = makeEmployeeXlsx({
        extraEntries: [{ name: "docProps/core.xml", contents: `<core>${"x".repeat(200_000)}</core>` }],
      });
      await assert.rejects(parseEmployeeImportXlsx(excessiveCompression), (error: unknown) => error instanceof EmployeeImportError && error.code === "too-large");
      const unsupportedEntry = makeEmployeeXlsx({
        extraEntries: [{ name: "xl/externalLinks/externalLink1.xml", contents: "<externalLink/>" }],
      });
      await assert.rejects(parseEmployeeImportXlsx(unsupportedEntry), (error: unknown) => error instanceof EmployeeImportError && error.code === "unsupported");
    });

    it("rejects highly expanded XML and deep XML structures within bounded fixtures", async () => {
      const expanded = makeEmployeeXlsx({ worksheetPrefix: " ".repeat(8 * 1024 * 1024) });
      await assert.rejects(parseEmployeeImportXlsx(expanded), (error: unknown) => error instanceof EmployeeImportError && error.code === "too-large");
      const deepXml = `<styles xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${"<x>".repeat(34)}${"</x>".repeat(34)}</styles>`;
      const deepWorkbook = makeEmployeeXlsx({ extraEntries: [{ name: "xl/styles.xml", contents: deepXml }] });
      await assert.rejects(parseEmployeeImportXlsx(deepWorkbook), (error: unknown) => error instanceof EmployeeImportError && error.code === "too-large");
    });

    it("enforces the aggregate decompressed archive limit", async () => {
      const pattern = randomBytes(8 * 1024).toString("base64").replace(/[+/=]/g, "a");
      const extraEntries = Array.from({ length: 58 }, (_, index) => ({
        name: `xl/theme/theme${index + 1}.xml`,
        contents: `<theme>${pattern.repeat(36)}</theme>`,
      }));
      const workbook = makeEmployeeXlsx({ extraEntries });
      assert.ok(workbook.byteLength < MAX_EMPLOYEE_IMPORT_BYTES);
      await assert.rejects(
        parseEmployeeImportXlsx(workbook),
        (error: unknown) => error instanceof EmployeeImportError && error.code === "too-large",
      );
    });

    it("enforces the parse deadline and releases the single-parser slot", async () => {
      const originalNow = Date.now;
      let clock = originalNow();
      Date.now = () => clock;
      try {
        const pending = parseEmployeeImportXlsx(makeEmployeeXlsx());
        clock += MAX_XLSX_PARSE_TIME_MS + 1;
        await assert.rejects(pending, (error: unknown) => error instanceof EmployeeImportError && error.code === "timeout");
      } finally {
        Date.now = originalNow;
      }
      assert.equal((await parseEmployeeImportXlsx(makeEmployeeXlsx())).length, 2);
    });
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

  it("keeps required-field validation and existing-record duplicate detection across formats", async () => {
    const sourceRows = [
      "Full Name,Email,Department,Role",
      ",invalid-email,,",
      "Alex Morgan,alex@example.test,Operations,Employee",
    ];
    const csvPreview = buildImportPreview(parseEmployeeImportCsv(Buffer.from(sourceRows.join("\n"))), [{
      rowId: "existing",
      institutionEmployeeId: "",
      fullName: "Alex Morgan",
      officialEmail: "alex@example.test",
      phone: "",
      department: "Operations",
      role: "Employee",
    }]);
    const xlsxPreview = buildImportPreview(await parseEmployeeImportXlsx(makeEmployeeXlsx({
      rows: [
        ["Full Name", "Email", "Department", "Role"],
        ["", "invalid-email", "", ""],
        ["Alex Morgan", "alex@example.test", "Operations", "Employee"],
      ],
    })), [{
      rowId: "existing",
      institutionEmployeeId: "",
      fullName: "Alex Morgan",
      officialEmail: "alex@example.test",
      phone: "",
      department: "Operations",
      role: "Employee",
    }]);

    for (const preview of [csvPreview, xlsxPreview]) {
      assert.equal(preview[0].allowed, false);
      assert.ok(preview[0].issues.includes("Full name is required"));
      assert.ok(preview[0].issues.includes("Official email is invalid"));
      assert.equal(preview[1].duplicateState, "Existing Match");
    }
  });
});
