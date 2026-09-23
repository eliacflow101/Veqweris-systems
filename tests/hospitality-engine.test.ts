import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attachHospitalityPayment, buildHospitalityDashboardMetrics, createHospitalityOrder,
  transitionHospitalityOrder,
} from "../lib/hospitality";

describe("hospitality foundation", () => {
  it("flows one room-service order through preparation, delivery and shared billing/payment references", () => {
    let order = createHospitalityOrder({
      orderId: "order-1", institutionId: "hotel-1", orderType: "room_service",
      outletId: "outlet-1", roomId: "room-101", guestId: "guest-1",
      reservationId: "reservation-1", currency: "KES",
      inventoryReservationIds: ["inventory-reservation-1"],
      items: [{ itemId: "meal-1", name: "Breakfast", quantity: 1, unitAmount: 1200, totalAmount: 0, inventoryItemId: "inventory-item-1" }],
    });
    for (const status of ["confirmed", "in_preparation", "ready", "out_for_delivery", "delivered", "billed"] as const) {
      order = transitionHospitalityOrder(order, status);
    }
    order = attachHospitalityPayment(order, "payment-1");
    assert.equal(order.billId, "bill-order-1");
    assert.equal(order.paymentId, "payment-1");
    assert.equal(order.inventoryReservationIds[0], "inventory-reservation-1");
    assert.equal(order.items[0].inventoryItemId, "inventory-item-1");
    assert.throws(() => transitionHospitalityOrder(order, "received"));
  });

  it("calculates operational metrics without creating inventory or payment engines", () => {
    const metrics = buildHospitalityDashboardMetrics({
      rooms: [{ status: "occupied" }, { status: "available", housekeepingStatus: "open" }],
      reservations: [{ status: "checked_in" }],
      maintenance: [{ status: "reported" }],
      orders: [{ status: "paid", total: 1200 }, { status: "in_preparation", total: 500 }],
    });
    assert.deepEqual(metrics, {
      totalRooms: 2, availableRooms: 1, occupiedRooms: 1, roomsNeedingHousekeeping: 1,
      openMaintenance: 1, activeReservations: 1, openOrders: 1, ordersInPreparation: 1,
      deliveredOrders: 0, billedOrders: 0, paidOrders: 1, occupancyRate: 50, outletRevenue: 1200,
    });
  });
});
