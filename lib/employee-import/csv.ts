import { parse } from "csv-parse/sync";
import { EmployeeImportError } from "./errors";
import { normalizeImportHeaders } from "@/lib/people-engine";

export const MAX_EMPLOYEE_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_EMPLOYEE_IMPORT_ROWS = 1_000;
export const MAX_EMPLOYEE_IMPORT_PREVIEW_BYTES = 700 * 1024;
const MAX_CSV_RECORD_SIZE = 64 * 1024;
export const MAX_EMPLOYEE_IMPORT_COLUMNS = 64;

export type EmployeeImportCsvErrorCode = "empty" | "too-large" | "too-many-rows" | "invalid";

export class EmployeeImportCsvError extends EmployeeImportError {
  declare readonly code: EmployeeImportCsvErrorCode;

  constructor(code: EmployeeImportCsvErrorCode) {
    super(code);
    this.name = "EmployeeImportCsvError";
    this.code = code;
  }
}

export function parseEmployeeImportCsv(bytes: Uint8Array): Record<string, string>[] {
  if (bytes.byteLength === 0) throw new EmployeeImportCsvError("empty");
  if (bytes.byteLength > MAX_EMPLOYEE_IMPORT_BYTES) throw new EmployeeImportCsvError("too-large");

  let input: string;
  try {
    input = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new EmployeeImportCsvError("invalid");
  }

  if (input.includes("\0") || input.startsWith("PK") || input.startsWith("\u00d0\u00cf\u0011\u00e0")) {
    throw new EmployeeImportCsvError("invalid");
  }

  let rows: Record<string, string>[];
  try {
    rows = parse(input, {
      bom: true,
      columns(headers: string[]) {
        try {
          return normalizeImportHeaders(headers, MAX_EMPLOYEE_IMPORT_COLUMNS);
        } catch {
          throw new EmployeeImportCsvError("invalid");
        }
      },
      max_record_size: MAX_CSV_RECORD_SIZE,
      relax_column_count: false,
      skip_empty_lines: true,
      to: MAX_EMPLOYEE_IMPORT_ROWS + 1,
      trim: true,
    }) as Record<string, string>[];
  } catch (error) {
    if (error instanceof EmployeeImportCsvError) throw error;
    throw new EmployeeImportCsvError("invalid");
  }

  if (rows.length === 0) throw new EmployeeImportCsvError("empty");
  if (rows.length > MAX_EMPLOYEE_IMPORT_ROWS) throw new EmployeeImportCsvError("too-many-rows");
  return rows;
}
