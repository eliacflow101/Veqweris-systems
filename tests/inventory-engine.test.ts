import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createInventoryScenario,
  createProcurementRequest,
  createReservation,
  createResource,
  detectResourceConflicts,
  getInventoryAlerts,
  reconcileExpectedVsActual,
} from "../lib/inventory-engine";

describe("inventory engine - generic vertical operations", () => {
  it("uses the same inventory engine for supermarket, education, hospitality, and clinical scenarios", () => {
    const supermarket = createInventoryScenario("Supermarket product", "institution-a", 42, 18, 12, "units", "retail");
    const school = createInventoryScenario("School stationery", "institution-a", 9, 18, 12, "packs", "education");
    const hotel = createInventoryScenario("Hotel ingredient", "institution-a", 13, 16, 11, "kg", "hospitality");
    const hospital = createInventoryScenario("Hospital supply", "institution-a", 0, 14, 10, "boxes", "healthcare");

    assert.equal(supermarket.category, "retail");
    assert.equal(school.category, "education");
    assert.equal(hotel.category, "hospitality");
    assert.equal(hospital.category, "healthcare");

    assert.equal(supermarket.status, "Verified Stock");
    assert.equal(school.status, "Partially Known");
    assert.equal(hotel.status, "Partially Known");
    assert.equal(hospital.status, "Awaiting Confirmation");
  });

  it("tracks reservations and procurement generically without inventing stock", () => {
    const item = createInventoryScenario("Core stock item", "institution-a", 12, 8, 6, "units", "general");
    const reservation = createReservation({
      itemId: item.id,
      institutionId: item.institutionId,
      requestedQuantity: 5,
      status: "Requested",
      verified: true,
      actorUid: "owner-a",
    });
    const request = createProcurementRequest({
      institutionId: item.institutionId,
      module: "inventory",
      departmentId: "department-a",
      supplierId: "supplier-1",
      itemId: item.id,
      quantity: 20,
      status: "Request",
      requestedBy: "owner-a",
      approvalRequired: true,
    });

    assert.equal(reservation.verified, true);
    assert.equal(reservation.status, "Confirmed");
    assert.equal(request.status, "Request");
    assert.equal(request.approvalRequired, true);
  });

  it("flags low stock, expiry and reconciliation exceptions in a deterministic way", () => {
    const lowItem = createInventoryScenario("Threshold item", "institution-a", 4, 8, 6, "units", "general");
    const alerts = getInventoryAlerts({ ...lowItem, expiryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString() });
    const variance = reconcileExpectedVsActual(20, 0, 0);

    assert.ok(alerts.some((alert) => alert.type === "low_stock"));
    assert.ok(alerts.some((alert) => alert.type === "expiry"));
    assert.equal(variance.status, "Inventory Reconciliation Exception");
    assert.equal(variance.action, "Escalate");
  });

  it("detects resource conflicts without silently reassigning capacity", () => {
    const room = createResource({
      id: "room-1",
      institutionId: "institution-a",
      name: "Room 1",
      type: "room",
      locationId: "loc-a",
      capacity: 4,
      occupied: 4,
      status: "Maintenance Due",
      maintenanceDueAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const conflicts = detectResourceConflicts([room], [{ resourceId: "room-1", start: "2026-01-01T10:00:00Z", end: "2026-01-01T11:00:00Z" }]);

    assert.equal(room.status, "Maintenance Due");
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].reason, "resource unavailable");
  });
});
