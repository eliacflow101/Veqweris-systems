import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRetailDashboardMetrics, completeRetailSale, createRetailSale } from "../lib/retail";

describe("retail engine", () => {
  it("creates a sale and completes it with shared billing, payment and inventory references", () => {
    const sale = createRetailSale({
      saleId: "sale-1", institutionId: "shop-1", currency: "KES",
      lines: [{ lineId: "line-1", catalogItemId: "sku-1", name: "Coffee", quantity: 2, unitAmount: 150, totalAmount: 0, inventoryItemId: "inventory-1" }],
    });
    const completed = completeRetailSale(sale, [{ inventoryItemId: "inventory-1", quantity: 2, reservationId: "reservation-1" }], "bill-1", "payment-1", "receipt-1");
    assert.equal(completed.total, 300);
    assert.equal(completed.status, "completed");
    assert.equal(completed.inventoryDeductions[0].reservationId, "reservation-1");
  });

  it("reports completed revenue and open sales", () => {
    const sale = createRetailSale({
      saleId: "sale-2", institutionId: "shop-1", currency: "KES",
      lines: [{ lineId: "line-1", catalogItemId: "sku-1", name: "Tea", quantity: 1, unitAmount: 80, totalAmount: 0 }],
    });
    assert.deepEqual(buildRetailDashboardMetrics({
      catalog: [{ catalogItemId: "sku-1", institutionId: "shop-1", name: "Tea", sku: "TEA", price: 80, currency: "KES", active: true }],
      sales: [sale],
    }), { catalogItems: 1, completedSales: 0, openSales: 1, revenue: 0, inventoryDeductions: 0 });
  });
});
