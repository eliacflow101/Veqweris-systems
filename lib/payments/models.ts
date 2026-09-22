export type PaymentStatus =
  | "INITIATED"
  | "PENDING"
  | "PROVIDER_PROCESSING"
  | "PROVIDER_CONFIRMATION"
  | "SERVER_VERIFICATION"
  | "VERIFIED"
  | "FINALIZED"
  | "FAILED"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "REVERSED"
  | "DISPUTED";

export type RefundStatus = "REQUESTED" | "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED";
export type FinancialExceptionStatus = "DETECTED" | "TRIAGED" | "INVESTIGATING" | "EVIDENCE_REQUESTED" | "RESOLVED" | "ADJUSTED" | "VERIFIED" | "CLOSED";

export interface BillItem {
  itemId: string;
  description: string;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
}

export interface BillRecord {
  billId: string;
  institutionId: string;
  customerUid?: string | null;
  customerReference?: string | null;
  items: BillItem[];
  subtotal: number;
  discount: number;
  tax: number;
  adjustment: number;
  credit: number;
  total: number;
  currency: string;
  status: "OPEN" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PaymentRecord {
  paymentId: string;
  institutionId: string;
  billId: string;
  customerUid?: string | null;
  customerReference?: string | null;
  originalAmount: number;
  originalCurrency: string;
  transactionAmount: number;
  transactionCurrency: string;
  institutionBaseCurrency: string;
  settlementCurrency?: string | null;
  settlementAmount?: number | null;
  exchangeRate?: number | null;
  exchangeRateSource?: string | null;
  exchangeRateTimestamp?: unknown;
  providerFees?: number | null;
  charges?: number | null;
  netSettlement?: number | null;
  provider: "flutterwave";
  providerReference?: string | null;
  internalReference: string;
  paymentMethod?: string | null;
  status: PaymentStatus;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  createdAt: unknown;
  updatedAt: unknown;
  verifiedAt?: unknown;
}

export interface RefundRecord {
  refundId: string;
  paymentId: string;
  institutionId: string;
  amount: number;
  currency: string;
  reason?: string;
  status: RefundStatus;
  providerReference?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface ReceiptRecord {
  receiptId: string;
  paymentId: string;
  billId: string;
  institutionId: string;
  customerReference?: string | null;
  amount: number;
  currency: string;
  paymentMethod?: string | null;
  provider: "flutterwave";
  reference: string;
  status: "PAID";
  issuedAt: unknown;
}

export interface FinancialEvent {
  eventId: string;
  institutionId: string;
  kind: "EXPECTED" | "ACTUAL";
  eventType: string;
  billId?: string | null;
  paymentId?: string | null;
  amount: number;
  currency: string;
  reference?: string | null;
  createdAt: unknown;
}

export interface FinancialReconciliation {
  reconciliationId: string;
  institutionId: string;
  expectedEventId: string;
  actualEventId?: string | null;
  status: "MATCHED" | "EXCEPTION";
  exceptionType?: "PAID_NOT_POSTED" | "POSTED_NOT_PAID" | "DUPLICATE_PAYMENT" | "INCORRECT_AMOUNT" | "PARTIAL_PAYMENT" | "REFUND_MISMATCH" | "MISSING_FINANCIAL_EVENT";
  message?: string;
  createdAt: unknown;
}

export interface FinancialException {
  exceptionId: string;
  institutionId: string;
  status: FinancialExceptionStatus;
  title: string;
  description: string;
  relatedPaymentId?: string | null;
  relatedBillId?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}
