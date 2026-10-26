import { TextDecoder } from "node:util";
import type { Readable } from "node:stream";
import { SaxesParser, type SaxesTagNS } from "saxes";
import * as yauzl from "yauzl";
import { canonicalImportField, normalizeImportHeaders } from "@/lib/people-engine";
import { EmployeeImportError } from "./errors";
import { MAX_EMPLOYEE_IMPORT_BYTES, MAX_EMPLOYEE_IMPORT_COLUMNS, MAX_EMPLOYEE_IMPORT_ROWS } from "./csv";

export const MAX_XLSX_ARCHIVE_ENTRIES = 64;
export const MAX_XLSX_EXPANDED_BYTES = 16 * 1024 * 1024;
export const MAX_XLSX_ENTRY_BYTES = 8 * 1024 * 1024;
export const MAX_XLSX_SHARED_STRINGS = 10_000;
export const MAX_XLSX_SHARED_STRING_BYTES = 2 * 1024 * 1024;
export const MAX_XLSX_PARSE_TIME_MS = 10_000;

const MAX_XLSX_COMPRESSION_RATIO = 100;
const MAX_XML_DEPTH = 32;
const MAX_XML_ELEMENTS = 150_000;
const MAX_XML_CHUNK_BYTES = 8 * 1024;
const MAX_CELL_TEXT_LENGTH = 2_048;
const SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELATIONSHIP_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELATIONSHIP_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const WORKSHEET_RELATIONSHIP = `${RELATIONSHIP_NS}/worksheet`;
const SHARED_STRINGS_RELATIONSHIP = `${RELATIONSHIP_NS}/sharedStrings`;
const STYLES_RELATIONSHIP = `${RELATIONSHIP_NS}/styles`;
const THEME_RELATIONSHIP = `${RELATIONSHIP_NS}/theme`;
const CORE_PROPERTIES_RELATIONSHIP = `${PACKAGE_RELATIONSHIP_NS}/metadata/core-properties`;
const EXTENDED_PROPERTIES_RELATIONSHIP = `${RELATIONSHIP_NS}/extended-properties`;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

type XmlHandlers = {
  open?: (tag: SaxesTagNS, stack: string[]) => void;
  text?: (text: string, stack: string[]) => void;
  close?: (tag: SaxesTagNS, stack: string[]) => void;
};

type ZipEntry = yauzl.Entry;
type WorkbookPart = { bytes: Buffer; entry: ZipEntry };
type Cell = { type: string; value: string };
type ParsedSheet = { rows: Map<number, Map<number, Cell>>; cellCount: number };
type WorkbookRelationship = { id: string; type: string; target: string };

let activeParses = 0;

function fail(code: ConstructorParameters<typeof EmployeeImportError>[0]): never {
  throw new EmployeeImportError(code);
}

function checkDeadline(deadline: number) {
  if (Date.now() > deadline) fail("timeout");
}

function localName(tag: SaxesTagNS) {
  return tag.local ?? tag.name.split(":").pop() ?? tag.name;
}

function attribute(tag: SaxesTagNS, name: string, namespace?: string) {
  for (const value of Object.values(tag.attributes)) {
    if (value.local === name && (!namespace || value.uri === namespace)) return value.value;
  }
  return undefined;
}

function parseXml(bytes: Buffer, deadline: number, handlers: XmlHandlers = {}) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parser = new SaxesParser({
    xmlns: true,
    position: false,
    forceXMLVersion: true,
    defaultXMLVersion: "1.0",
  });
  const stack: string[] = [];
  let elementCount = 0;
  parser.on("error", () => fail("invalid"));
  parser.on("xmldecl", (declaration) => {
    if ((declaration.version && declaration.version !== "1.0")
      || (declaration.encoding && !/^utf-?8$/i.test(declaration.encoding))) fail("unsupported");
  });
  parser.on("doctype", () => fail("unsupported"));
  parser.on("processinginstruction", () => fail("unsupported"));
  parser.on("cdata", () => fail("unsupported"));
  parser.on("opentag", (tag) => {
    elementCount += 1;
    if (elementCount > MAX_XML_ELEMENTS || stack.length >= MAX_XML_DEPTH) fail("too-large");
    stack.push(localName(tag));
    handlers.open?.(tag, stack);
  });
  parser.on("text", (text) => handlers.text?.(text, stack));
  parser.on("closetag", (tag) => {
    handlers.close?.(tag, stack);
    stack.pop();
  });

  try {
    for (let offset = 0; offset < bytes.byteLength; offset += MAX_XML_CHUNK_BYTES) {
      checkDeadline(deadline);
      const chunk = decoder.decode(bytes.subarray(offset, offset + MAX_XML_CHUNK_BYTES), { stream: true });
      if (chunk.includes("\0")) fail("invalid");
      parser.write(chunk);
    }
    const remaining = decoder.decode();
    if (remaining.includes("\0")) fail("invalid");
    parser.write(remaining).close();
    if (stack.length !== 0) fail("invalid");
  } catch (error) {
    if (error instanceof EmployeeImportError) throw error;
    fail("invalid");
  }
}

function updateCrc32(crc: number, bytes: Buffer) {
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

function resolveTarget(source: string, target: string) {
  if (!target || target.includes("\\") || /[\u0000-\u001f?#]/.test(target)) fail("invalid");
  const rootRelative = target.startsWith("/") ? target.slice(1) : target;
  const base = source === "" ? "" : source.slice(0, source.lastIndexOf("/") + 1);
  const parts = rootRelative.startsWith("xl/") ? rootRelative.split("/") : `${base}${rootRelative}`.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (normalized.length === 0) fail("invalid");
      normalized.pop();
    } else normalized.push(part);
  }
  return normalized.join("/");
}

function allowedArchivePart(name: string) {
  return name === "[Content_Types].xml"
    || name === "_rels/.rels"
    || name === "xl/workbook.xml"
    || name === "xl/_rels/workbook.xml.rels"
    || name === "xl/sharedStrings.xml"
    || name === "xl/styles.xml"
    || /^xl\/worksheets\/sheet[1-9]\d*\.xml$/.test(name)
    || /^xl\/theme\/theme[1-9]\d*\.xml$/.test(name)
    || name === "docProps/app.xml"
    || name === "docProps/core.xml";
}

async function readZipPart(
  zip: yauzl.ZipFile,
  entry: ZipEntry,
  partLimit: number,
  total: { bytes: number },
  deadline: number,
  activeStream: { current?: Readable },
): Promise<Buffer> {
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0
    || !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0
    || entry.uncompressedSize > partLimit
    || entry.uncompressedSize > Math.max(1, entry.compressedSize) * MAX_XLSX_COMPRESSION_RATIO
    || entry.uncompressedSize + total.bytes > MAX_XLSX_EXPANDED_BYTES) {
    fail("too-large");
  }
  if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod) || !entry.canDecodeFileData()) {
    fail("unsupported");
  }

  const stream: Readable = await zip.openReadStreamPromise(entry);
  activeStream.current = stream;
  const chunks: Buffer[] = [];
  let entryBytes = 0;
  let crc = 0xffffffff;
  try {
    for await (const chunk of stream) {
      checkDeadline(deadline);
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      entryBytes += bytes.byteLength;
      total.bytes += bytes.byteLength;
      if (entryBytes > partLimit || total.bytes > MAX_XLSX_EXPANDED_BYTES) fail("too-large");
      crc = updateCrc32(crc, bytes);
      chunks.push(bytes);
    }
    const data = Buffer.concat(chunks, entryBytes);
    if (entryBytes !== entry.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== entry.crc32) fail("invalid");
    return data;
  } catch (error) {
    stream.destroy();
    if (error instanceof EmployeeImportError) throw error;
    fail("invalid");
  } finally {
    activeStream.current = undefined;
  }
}

function validatePath(name: string) {
  if (!name || name.length > 256 || name.startsWith("/") || name.includes("\\")
    || name.split("/").some((part) => !part || part === "." || part === "..")
    || /[\u0000-\u001f]/.test(name)) fail("invalid");
  if (/(?:vbaProject|externalLinks|embeddings|activeX|oleObjects|connections|queryTables|pivot|slicer|customXml|ctrlProps|printerSettings)/i.test(name)) {
    fail("unsupported");
  }
}

function readRelationships(bytes: Buffer, deadline: number, source: string) {
  const relationships: WorkbookRelationship[] = [];
  const ids = new Set<string>();
  parseXml(bytes, deadline, {
    open(tag, stack) {
      if (tag.uri !== PACKAGE_RELATIONSHIP_NS) fail("invalid");
      if (stack.length === 1 && localName(tag) !== "Relationships") fail("invalid");
      if (stack.length > 2 || (stack.length === 2 && localName(tag) !== "Relationship")) fail("invalid");
      if (stack.length === 2 && localName(tag) === "Relationship") {
        const targetMode = attribute(tag, "TargetMode")?.toLowerCase();
        if (targetMode && targetMode !== "internal") fail("unsupported");
        const id = attribute(tag, "Id");
        const type = attribute(tag, "Type");
        const target = attribute(tag, "Target");
        if (!id || ids.has(id) || !type || !target) fail("invalid");
        ids.add(id);
        relationships.push({ id, type, target: resolveTarget(source, target) });
      }
    },
  });
  return relationships;
}

function readContentTypes(bytes: Buffer, deadline: number) {
  const contentTypes = new Map<string, string>();
  const defaultExtensions = new Set<string>();
  parseXml(bytes, deadline, {
    open(tag, stack) {
      if (tag.uri !== CONTENT_TYPES_NS) fail("invalid");
      if (stack.length === 1 && localName(tag) !== "Types") fail("invalid");
      if (stack.length > 2 || (stack.length === 2 && !["Override", "Default"].includes(localName(tag)))) fail("invalid");
      if (stack.length === 2 && ["Override", "Default"].includes(localName(tag))) {
        const partName = attribute(tag, "PartName");
        const contentType = attribute(tag, "ContentType");
        if (!contentType || (localName(tag) === "Override" && (!partName || !partName.startsWith("/")))) fail("invalid");
        if (/macroEnabled|vbaProject|externalLink|oleObject|activeX/i.test(contentType)) fail("unsupported");
        if (localName(tag) === "Override") {
          const key = partName!.slice(1);
          if (contentTypes.has(key)) fail("invalid");
          contentTypes.set(key, contentType);
        } else {
          const extension = attribute(tag, "Extension")?.toLowerCase();
          if (!extension || !/^[a-z0-9]+$/.test(extension) || defaultExtensions.has(extension)) fail("invalid");
          defaultExtensions.add(extension);
        }
      }
    },
  });
  return contentTypes;
}

function readWorkbook(bytes: Buffer, deadline: number) {
  let sheet: { id: string; name: string } | undefined;
  parseXml(bytes, deadline, {
    open(tag, stack) {
      const name = localName(tag);
      if (tag.uri !== SPREADSHEET_NS) fail("invalid");
      if (stack.length === 1 && name !== "workbook") fail("invalid");
      if (["definedNames", "externalReferences", "extLst", "workbookProtection", "webPublishObjects"].includes(name)) fail("unsupported");
      if (stack.length === 3 && stack[1] === "sheets" && name === "sheet") {
        if (sheet) fail("unsupported");
        const relationId = attribute(tag, "id", RELATIONSHIP_NS);
        const sheetName = attribute(tag, "name");
        const state = attribute(tag, "state");
        if (!relationId || !sheetName || !sheetName.trim() || (state && state !== "visible")) fail("unsupported");
        sheet = { id: relationId, name: sheetName };
      }
    },
  });
  if (!sheet) fail("invalid");
  return sheet;
}

function readSharedStrings(bytes: Buffer, deadline: number) {
  const values: string[] = [];
  let current = "";
  let inString = false;
  let totalChars = 0;
  parseXml(bytes, deadline, {
    open(tag, stack) {
      const name = localName(tag);
      if (tag.uri !== SPREADSHEET_NS) fail("invalid");
      if (stack.length === 1 && name !== "sst") fail("invalid");
      if (name === "phoneticPr" || name === "rPh" || name === "extLst") fail("unsupported");
      if (name === "si") {
        if (stack.length !== 2) fail("invalid");
        if (inString) fail("invalid");
        inString = true;
        current = "";
      } else if (name === "t") {
        if (stack.length !== 3 || stack[1] !== "si") fail("unsupported");
      } else if (stack.length > 3 || stack.length === 2 || stack.length === 3) {
        fail("unsupported");
      }
    },
    text(text, stack) {
      if (inString && stack.at(-1) === "t") {
        current += text;
        totalChars += text.length;
        if (current.length > MAX_CELL_TEXT_LENGTH || totalChars > MAX_XLSX_SHARED_STRING_BYTES) fail("too-large");
      }
    },
    close(tag) {
      if (localName(tag) === "si") {
        if (!inString || values.length >= MAX_XLSX_SHARED_STRINGS) fail("too-large");
        values.push(current);
        inString = false;
      }
    },
  });
  return values;
}

function columnIndex(reference: string) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,3})$/.exec(reference);
  if (!match) fail("invalid");
  let column = 0;
  for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (column < 1) fail("invalid");
  if (column > MAX_EMPLOYEE_IMPORT_COLUMNS) fail("too-many-columns");
  if (row > MAX_EMPLOYEE_IMPORT_ROWS + 1) fail("too-many-rows");
  return { column: column - 1, row };
}

function validateDimension(reference: string) {
  const [start, end = start] = reference.split(":");
  if (reference.split(":").length > 2) fail("invalid");
  const first = columnIndex(start);
  const last = columnIndex(end);
  if (last.column < first.column || last.row < first.row) fail("invalid");
}

function readWorksheet(bytes: Buffer, deadline: number): ParsedSheet {
  const rows = new Map<number, Map<number, Cell>>();
  let currentRow: number | undefined;
  let currentCell: {
    column: number;
    type: string;
    value: string;
    valueKind?: "v" | "t";
    contentStarted?: boolean;
    inlineTextSeen?: boolean;
  } | undefined;
  let valueBuffer = "";
  let cellCount = 0;
  let hasSheetData = false;
  let lastRow = 0;
  parseXml(bytes, deadline, {
    open(tag, stack) {
      const name = localName(tag);
      if (tag.uri !== SPREADSHEET_NS) fail("invalid");
      if (stack.length === 1 && name !== "worksheet") fail("invalid");
      if (name === "f") fail("unsupported");
      if (["extLst", "legacyDrawing", "drawing", "oleObjects", "controls", "tableParts", "webPublishItems"].includes(name)) fail("unsupported");
      if (name === "dimension") {
        const dimension = attribute(tag, "ref");
        if (!dimension) fail("invalid");
        validateDimension(dimension);
      }
      if (name === "sheetData") {
        if (stack.length !== 2) fail("invalid");
        if (hasSheetData) fail("invalid");
        hasSheetData = true;
      }
      if (name === "row" && !(stack.length === 3 && stack[1] === "sheetData")) fail("invalid");
      if (stack.length === 3 && stack[1] === "sheetData" && name !== "row") fail("invalid");
      if (stack.length === 4 && stack[2] === "row" && name !== "c") fail("invalid");
      if (name === "row" && stack.length === 3 && stack[1] === "sheetData") {
        if (currentRow !== undefined) fail("invalid");
        const rowValue = attribute(tag, "r");
        if (!rowValue || !/^[1-9]\d{0,3}$/.test(rowValue)) fail("invalid");
        currentRow = Number(rowValue);
        if (currentRow > MAX_EMPLOYEE_IMPORT_ROWS + 1) fail("too-many-rows");
        if (currentRow <= lastRow || rows.has(currentRow)) fail("invalid");
        lastRow = currentRow;
        rows.set(currentRow, new Map());
      }
      if (name === "c") {
        if (currentRow === undefined || currentCell || stack.length !== 4 || stack[1] !== "sheetData" || stack[2] !== "row") fail("invalid");
        const reference = attribute(tag, "r");
        if (!reference) fail("invalid");
        const parsedReference = columnIndex(reference);
        if (parsedReference.row !== currentRow) fail("invalid");
        const row = rows.get(currentRow)!;
        if (row.has(parsedReference.column)) fail("invalid");
        cellCount += 1;
        if (cellCount > (MAX_EMPLOYEE_IMPORT_ROWS + 1) * MAX_EMPLOYEE_IMPORT_COLUMNS) fail("too-large");
        currentCell = { column: parsedReference.column, type: attribute(tag, "t") ?? "n", value: "" };
        row.set(parsedReference.column, currentCell);
      }
      if (currentCell) {
        const cellChild = stack.length === 5 && stack[3] === "c" && ((name === "v" && currentCell.type !== "inlineStr")
          || (name === "is" && currentCell.type === "inlineStr"));
        const inlineText = stack.length === 6 && stack[4] === "is" && name === "t" && currentCell.type === "inlineStr";
        if (stack.length > 4 && !cellChild && !inlineText) fail("invalid");
        if (cellChild) {
          if (currentCell.contentStarted) fail("invalid");
          currentCell.contentStarted = true;
        }
        if (inlineText) {
          if (currentCell.inlineTextSeen) fail("invalid");
          currentCell.inlineTextSeen = true;
        }
      }
      if (name === "v" && currentCell) {
        currentCell.valueKind = "v";
        valueBuffer = "";
      } else if (name === "t" && currentCell?.type === "inlineStr") {
        currentCell.valueKind = "t";
        valueBuffer = "";
      } else if (name === "is" && currentCell && currentCell.type !== "inlineStr") {
        fail("invalid");
      }
    },
    text(text, stack) {
      if (currentCell?.valueKind && (stack.at(-1) === "v" || stack.at(-1) === "t")) {
        valueBuffer += text;
        if (valueBuffer.length > MAX_CELL_TEXT_LENGTH) fail("too-large");
      }
    },
    close(tag) {
      const name = localName(tag);
      if ((name === "v" || name === "t") && currentCell?.valueKind) {
        currentCell.value += valueBuffer;
        currentCell.valueKind = undefined;
        valueBuffer = "";
      }
      if (name === "c") currentCell = undefined;
      if (name === "row") currentRow = undefined;
    },
  });
  if (!hasSheetData || currentCell || currentRow !== undefined) fail("invalid");
  return { rows, cellCount };
}

function normalizeSheetRows(sheet: ParsedSheet, sharedStrings: string[]) {
  const headerRow = sheet.rows.get(1);
  if (!headerRow || headerRow.size === 0) fail("invalid");
  const lastColumn = Math.max(...headerRow.keys());
  const rawHeaders: string[] = [];
  for (let index = 0; index <= lastColumn; index += 1) {
    const header = headerRow.get(index);
    if (!header) fail("invalid");
    rawHeaders.push(readCellValue(header, sharedStrings));
  }
  let headers: string[];
  try {
    headers = normalizeImportHeaders(rawHeaders, MAX_EMPLOYEE_IMPORT_COLUMNS);
  } catch {
    fail("invalid");
  }
  const fieldByColumn = headers.map(canonicalImportField);
  if (!["fullName", "officialEmail", "department", "role"].every((field) => fieldByColumn.includes(field))) fail("invalid");
  const records: Record<string, string>[] = [];
  for (const [rowNumber, cells] of sheet.rows) {
    if (rowNumber === 1) continue;
    if ([...cells.keys()].some((column) => column > lastColumn)) fail("invalid");
    const record: Record<string, string> = {};
    let hasValue = false;
    for (let index = 0; index < headers.length; index += 1) {
      const cell = cells.get(index);
      if (!cell) {
        record[headers[index]] = "";
        continue;
      }
      if (cell.value && cell.type === "n" && ["institutionEmployeeId", "phone"].includes(String(fieldByColumn[index]))) {
        fail("unsupported");
      }
      const value = readCellValue(cell, sharedStrings);
      record[headers[index]] = value;
      if (value.trim()) hasValue = true;
    }
    if (hasValue) records.push(record);
    if (records.length > MAX_EMPLOYEE_IMPORT_ROWS) fail("too-many-rows");
  }
  if (records.length === 0) fail("empty");
  return records;
}

function readCellValue(cell: Cell, sharedStrings: string[]) {
  if (cell.type === "s") {
    if (!/^(0|[1-9]\d*)$/.test(cell.value)) fail("invalid");
    const value = sharedStrings[Number(cell.value)];
    if (value === undefined) fail("invalid");
    return value;
  }
  if (!["n", "inlineStr", "str"].includes(cell.type)) {
    if (!cell.value) return "";
    fail("unsupported");
  }
  return cell.value;
}

function validateOptionalXml(bytes: Buffer, deadline: number) {
  parseXml(bytes, deadline);
}

export async function parseEmployeeImportXlsx(input: Uint8Array): Promise<Record<string, string>[]> {
  if (activeParses > 0) fail("busy");
  activeParses += 1;
  const deadline = Date.now() + MAX_XLSX_PARSE_TIME_MS;
  let timeout: NodeJS.Timeout | undefined;
  const activeStream: { current?: Readable } = {};
  let timedOut = false;
  timeout = setTimeout(() => {
    timedOut = true;
    activeStream.current?.destroy(new Error("Workbook parsing exceeded its time limit."));
  }, MAX_XLSX_PARSE_TIME_MS);
  timeout.unref();

  let zip: yauzl.ZipFile | undefined;
  try {
    if (input.byteLength === 0) fail("empty");
    if (input.byteLength > MAX_EMPLOYEE_IMPORT_BYTES) fail("too-large");
    const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    zip = await yauzl.fromBufferPromise(buffer, {
      autoClose: false,
      lazyEntries: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
    if (zip.entryCount < 1 || zip.entryCount > MAX_XLSX_ARCHIVE_ENTRIES) fail("too-large");

    const entries = new Map<string, ZipEntry>();
    let worksheetEntryCount = 0;
    let enumeratedEntries = 0;
    for await (const entry of zip.eachEntry()) {
      checkDeadline(deadline);
      enumeratedEntries += 1;
      if (entry.fileName.endsWith("/")) {
        validatePath(entry.fileName.slice(0, -1));
        continue;
      }
      validatePath(entry.fileName);
      if (entries.has(entry.fileName)) fail("invalid");
      if (!allowedArchivePart(entry.fileName)) fail("unsupported");
      if (entry.fileName.startsWith("xl/worksheets/sheet")) worksheetEntryCount += 1;
      entries.set(entry.fileName, entry);
    }
    if (enumeratedEntries !== zip.entryCount) fail("invalid");
    if (worksheetEntryCount !== 1) fail("unsupported");

    const requiredParts = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"];
    if (requiredParts.some((name) => !entries.has(name))) fail("invalid");
    const total = { bytes: 0 };
    const parts = new Map<string, WorkbookPart>();
    for (const [name, entry] of entries) {
      const partLimit = name === "xl/sharedStrings.xml" ? MAX_XLSX_SHARED_STRING_BYTES
        : name.startsWith("xl/worksheets/") ? MAX_XLSX_ENTRY_BYTES
          : 1024 * 1024;
      const bytes = await readZipPart(zip, entry, partLimit, total, deadline, activeStream);
      if (name.endsWith(".xml") || name.endsWith(".rels")) parts.set(name, { bytes, entry });
    }
    if (timedOut) fail("timeout");

    const contentTypes = readContentTypes(parts.get("[Content_Types].xml")!.bytes, deadline);
    if (contentTypes.get("xl/workbook.xml") !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml") fail("unsupported");
    const rootRelationships = readRelationships(parts.get("_rels/.rels")!.bytes, deadline, "");
    const officeDocument = rootRelationships.filter((item) => item.type === `${RELATIONSHIP_NS}/officeDocument`);
    if (officeDocument.length !== 1 || officeDocument[0].target !== "xl/workbook.xml") fail("invalid");
    const supportedRootRelationshipTypes = new Set([
      `${RELATIONSHIP_NS}/officeDocument`, CORE_PROPERTIES_RELATIONSHIP, EXTENDED_PROPERTIES_RELATIONSHIP,
    ]);
    if (rootRelationships.some((item) => !supportedRootRelationshipTypes.has(item.type)
      || !parts.has(item.target))) fail("unsupported");

    const workbook = readWorkbook(parts.get("xl/workbook.xml")!.bytes, deadline);
    const workbookRelationships = readRelationships(parts.get("xl/_rels/workbook.xml.rels")!.bytes, deadline, "xl/workbook.xml");
    const worksheetRelationships = workbookRelationships.filter((item) => item.type === WORKSHEET_RELATIONSHIP);
    const sharedStringRelationships = workbookRelationships.filter((item) => item.type === SHARED_STRINGS_RELATIONSHIP);
    const styleRelationships = workbookRelationships.filter((item) => item.type === STYLES_RELATIONSHIP);
    const themeRelationships = workbookRelationships.filter((item) => item.type === THEME_RELATIONSHIP);
    const supportedWorkbookRelationshipTypes = new Set([
      WORKSHEET_RELATIONSHIP, SHARED_STRINGS_RELATIONSHIP, STYLES_RELATIONSHIP, THEME_RELATIONSHIP,
    ]);
    if (worksheetRelationships.length !== 1 || worksheetRelationships[0].id !== workbook.id
      || sharedStringRelationships.length > 1 || styleRelationships.length > 1 || themeRelationships.length > 1
      || workbookRelationships.some((item) => !supportedWorkbookRelationshipTypes.has(item.type))) fail("unsupported");
    const worksheetName = worksheetRelationships[0].target;
    if (!/^xl\/worksheets\/sheet[1-9]\d*\.xml$/.test(worksheetName) || !parts.has(worksheetName)) fail("invalid");
    const sharedStringsName = sharedStringRelationships[0]?.target;
    if ((sharedStringsName && !parts.has(sharedStringsName)) || (parts.has("xl/sharedStrings.xml") && sharedStringsName !== "xl/sharedStrings.xml")) fail("invalid");
    if (contentTypes.get(worksheetName) !== "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml") fail("invalid");
    if (sharedStringsName && contentTypes.get(sharedStringsName) !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml") fail("invalid");
    if (styleRelationships.length === 1
      && (styleRelationships[0].target !== "xl/styles.xml"
        || !parts.has(styleRelationships[0].target)
        || contentTypes.get(styleRelationships[0].target) !== "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml")) fail("invalid");
    if (themeRelationships.length === 1
      && (!/^xl\/theme\/theme[1-9]\d*\.xml$/.test(themeRelationships[0].target) || !parts.has(themeRelationships[0].target))) fail("invalid");
    const themeParts = [...parts.keys()].filter((name) => name.startsWith("xl/theme/"));
    if ((parts.has("xl/styles.xml") !== (styleRelationships.length === 1))
      || (themeParts.length !== themeRelationships.length)
      || (themeParts.length === 1 && themeParts[0] !== themeRelationships[0]?.target)) fail("invalid");

    const coreXmlPaths = new Set([
      "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels",
      worksheetName, ...(sharedStringsName ? [sharedStringsName] : []),
    ]);
    for (const [name, part] of parts) {
      if (!coreXmlPaths.has(name)) validateOptionalXml(part.bytes, deadline);
    }
    const sharedStrings = sharedStringsName ? readSharedStrings(parts.get(sharedStringsName)!.bytes, deadline) : [];
    const sheet = readWorksheet(parts.get(worksheetName)!.bytes, deadline);
    return normalizeSheetRows(sheet, sharedStrings);
  } catch (error) {
    if (timedOut || Date.now() > deadline) fail("timeout");
    if (error instanceof EmployeeImportError) throw error;
    throw new EmployeeImportError("invalid");
  } finally {
    if (timeout) clearTimeout(timeout);
    if (zip?.isOpen) zip.close();
    activeParses -= 1;
  }
}
