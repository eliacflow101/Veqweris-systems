export type EmployeeImportErrorCode =
  | "empty"
  | "too-large"
  | "too-many-rows"
  | "too-many-columns"
  | "invalid"
  | "unsupported"
  | "busy"
  | "timeout"
  | "preview-too-large";

export class EmployeeImportError extends Error {
  constructor(readonly code: EmployeeImportErrorCode) {
    super(code);
    this.name = "EmployeeImportError";
  }
}
