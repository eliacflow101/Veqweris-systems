import type { RetailCatalogItem, RetailDashboardMetrics, RetailSale, RetailSaleLine } from "./models";

export function createRetailSale(input: {
  saleId: string; institutionId: string; lines: RetailSaleLine[]; currency: string;
  tax?: number; inventoryDeductions?: RetailSale["inventoryDeductions"];
  createdAt?: unknown; updatedAt?: unknown;
}): RetailSale {
  if (!input.lines.length) throw new Error("A retail sale requires at least one line.");
  if (input.lines.some((line) => line.quantity <= 0 || line.unitAmount < 0)) {
    throw new Error("Sale quantities must be positive and amounts cannot be negative.");
  }
  const lines = input.lines.map((line) => ({ ...line, totalAmount: line.quantity * line.unitAmount }));
  const subtotal = lines.reduce((sum, line) => sum + line.totalAmount, 0);
  return {
    saleId: input.saleId, institutionId: input.institutionId, lines, subtotal,
    tax: input.tax ?? 0, total: subtotal + (input.tax ?? 0), currency: input.currency,
    status: "draft", inventoryDeductions: [...(input.inventoryDeductions ?? [])],
    billId: null, paymentId: null, receiptId: null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: input.updatedAt ?? input.createdAt ?? new Date().toISOString(),
  };
}

export function completeRetailSale(sale: RetailSale, references: RetailSale["inventoryDeductions"], billId: string, paymentId: string, receiptId: string, now: unknown = new Date().toISOString()): RetailSale {
  if (sale.status !== "draft") throw new Error("Only draft sales can be completed.");
  return { ...sale, status: "completed", inventoryDeductions: [...references], billId, paymentId, receiptId, updatedAt: now };
}

export function buildRetailDashboardMetrics(input: { catalog: RetailCatalogItem[]; sales: Array<Pick<RetailSale, "status" | "total" | "inventoryDeductions">> }): RetailDashboardMetrics {
  return {
    catalogItems: input.catalog.filter((item) => item.active).length,
    completedSales: input.sales.filter((sale) => sale.status === "completed").length,
    openSales: input.sales.filter((sale) => sale.status === "draft").length,
    revenue: input.sales.filter((sale) => sale.status === "completed").reduce((sum, sale) => sum + sale.total, 0),
    inventoryDeductions: input.sales.reduce((sum, sale) => sum + sale.inventoryDeductions.length, 0),
  };
}
