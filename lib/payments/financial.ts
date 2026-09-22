import type { FinancialReconciliation } from "./models";

export function reconcileFinancialEvents(input: {
  reconciliationId: string;
  institutionId: string;
  expectedEventId: string;
  expectedAmount: number;
  expectedCurrency: string;
  actualEventId?: string;
  actualAmount?: number;
  actualCurrency?: string;
  createdAt?: unknown;
}): FinancialReconciliation {
  if (!input.actualEventId) {
    return {
      reconciliationId: input.reconciliationId,
      institutionId: input.institutionId,
      expectedEventId: input.expectedEventId,
      actualEventId: null,
      status: "EXCEPTION",
      exceptionType: "MISSING_FINANCIAL_EVENT",
      message: "Potential Financial Leakage: expected financial event has no matching actual event.",
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
  }
  if (input.actualCurrency?.toUpperCase() !== input.expectedCurrency.toUpperCase()) {
    return {
      reconciliationId: input.reconciliationId,
      institutionId: input.institutionId,
      expectedEventId: input.expectedEventId,
      actualEventId: input.actualEventId,
      status: "EXCEPTION",
      exceptionType: "INCORRECT_AMOUNT",
      message: "Actual event currency does not match expected currency.",
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
  }
  if (input.actualAmount !== input.expectedAmount) {
    return {
      reconciliationId: input.reconciliationId,
      institutionId: input.institutionId,
      expectedEventId: input.expectedEventId,
      actualEventId: input.actualEventId,
      status: "EXCEPTION",
      exceptionType: input.actualAmount !== undefined && input.actualAmount < input.expectedAmount ? "PARTIAL_PAYMENT" : "INCORRECT_AMOUNT",
      message: "Potential Financial Leakage: expected and actual amounts differ.",
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
  }
  return {
    reconciliationId: input.reconciliationId,
    institutionId: input.institutionId,
    expectedEventId: input.expectedEventId,
    actualEventId: input.actualEventId,
    status: "MATCHED",
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}
