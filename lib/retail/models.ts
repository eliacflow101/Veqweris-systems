import type { InventoryDeductionReference } from "@/lib/hospitality";

export type RetailSaleStatus = "draft" | "completed" | "refunded" | "voided";

export interface RetailCatalogItem {
  catalogItemId: string;
  institutionId: string;
  name: string;
  sku: string;
  description?: string | null;
  price: number;
  currency: string;
  inventoryItemId?: string | null;
  active: boolean;
}

export interface RetailSaleLine {
  lineId: string;
  catalogItemId: string;
  name: string;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
  inventoryItemId?: string | null;
}

export interface RetailSale {
  saleId: string;
  institutionId: string;
  lines: RetailSaleLine[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  status: RetailSaleStatus;
  inventoryDeductions: InventoryDeductionReference[];
  billId?: string | null;
  paymentId?: string | null;
  receiptId?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface RetailDashboardMetrics {
  catalogItems: number;
  completedSales: number;
  openSales: number;
  revenue: number;
  inventoryDeductions: number;
}
