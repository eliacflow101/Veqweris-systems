import type {
  HospitalityDashboardMetrics, HospitalityOrder, HospitalityOrderStatus, HospitalityOrderItem,
  HotelReservation, HotelRoom, HousekeepingTask, MaintenanceTicket,
} from "./models";
import type { ReservationStatus } from "./models";

const reservationTransitions: Record<ReservationStatus, ReservationStatus[]> = {
  inquiry: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["checked_out"],
  checked_out: [],
  cancelled: [],
  no_show: [],
};

export function canTransitionReservation(from: ReservationStatus, to: ReservationStatus) {
  return reservationTransitions[from].includes(to);
}

export function transitionReservation(reservation: HotelReservation, status: ReservationStatus, now: unknown = new Date().toISOString()): HotelReservation {
  if (!canTransitionReservation(reservation.status, status)) {
    throw new Error(`Invalid reservation transition from ${reservation.status} to ${status}.`);
  }
  return { ...reservation, status, updatedAt: now };
}

const orderTransitions: Record<HospitalityOrderStatus, HospitalityOrderStatus[]> = {
  received: ["confirmed", "cancelled"],
  confirmed: ["in_preparation", "cancelled"],
  in_preparation: ["ready", "cancelled"],
  ready: ["out_for_delivery", "delivered"],
  out_for_delivery: ["delivered"],
  delivered: ["billed"],
  billed: ["paid"],
  paid: [],
  cancelled: [],
};

export function canTransitionHospitalityOrder(from: HospitalityOrderStatus, to: HospitalityOrderStatus) {
  return orderTransitions[from].includes(to);
}

export function transitionHospitalityOrder(
  order: HospitalityOrder,
  status: HospitalityOrderStatus,
  now: unknown = new Date().toISOString(),
): HospitalityOrder {
  if (!canTransitionHospitalityOrder(order.status, status)) {
    throw new Error(`Invalid hospitality order transition from ${order.status} to ${status}.`);
  }
  return {
    ...order,
    status,
    updatedAt: now,
    ...(status === "billed" && !order.billId ? { billId: `bill-${order.orderId}` } : {}),
  };
}

export function createHospitalityOrder(input: {
  orderId: string;
  institutionId: string;
  orderType: HospitalityOrder["orderType"];
  outletId: string;
  items: HospitalityOrderItem[];
  currency: string;
  tax?: number;
  roomId?: string | null;
  guestId?: string | null;
  reservationId?: string | null;
  inventoryReservationIds?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}): HospitalityOrder {
  if (!input.items.length) throw new Error("A hospitality order requires at least one item.");
  if (input.items.some((item) => item.quantity <= 0 || item.unitAmount < 0)) {
    throw new Error("Order item quantities must be positive and amounts cannot be negative.");
  }
  const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitAmount, 0);
  const tax = input.tax ?? 0;
  return {
    orderId: input.orderId,
    institutionId: input.institutionId,
    orderType: input.orderType,
    outletId: input.outletId,
    roomId: input.roomId ?? null,
    guestId: input.guestId ?? null,
    reservationId: input.reservationId ?? null,
    items: input.items.map((item) => ({ ...item, totalAmount: item.quantity * item.unitAmount })),
    subtotal,
    tax,
    total: subtotal + tax,
    currency: input.currency,
    status: "received",
    inventoryReservationIds: [...(input.inventoryReservationIds ?? [])],
    billId: null,
    paymentId: null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: input.updatedAt ?? input.createdAt ?? new Date().toISOString(),
  };
}

export function attachHospitalityPayment(order: HospitalityOrder, paymentId: string, now: unknown = new Date().toISOString()) {
  if (order.status !== "billed") throw new Error("An order must be billed before payment is attached.");
  return { ...order, paymentId, updatedAt: now };
}

export function canCheckInReservation(reservation: Pick<HotelReservation, "status" | "checkIn" | "checkOut">, at: string) {
  return reservation.status === "confirmed" && at >= reservation.checkIn && at < reservation.checkOut;
}

export function isRoomAvailable(room: Pick<HotelRoom, "status">) {
  return room.status === "available";
}

export function canCompleteHousekeeping(task: Pick<HousekeepingTask, "status">) {
  return task.status === "inspected" || task.status === "in_progress";
}

export function canCloseMaintenance(ticket: Pick<MaintenanceTicket, "status">) {
  return ticket.status === "resolved";
}

export function buildHospitalityDashboardMetrics(input: {
  rooms: Array<Pick<HotelRoom, "status" | "housekeepingStatus">>;
  reservations: Array<Pick<HotelReservation, "status">>;
  maintenance: Array<Pick<MaintenanceTicket, "status">>;
  orders: Array<Pick<HospitalityOrder, "status" | "total">>;
}): HospitalityDashboardMetrics {
  const totalRooms = input.rooms.length;
  const occupiedRooms = input.rooms.filter((room) => room.status === "occupied").length;
  return {
    totalRooms,
    availableRooms: input.rooms.filter((room) => room.status === "available").length,
    occupiedRooms,
    roomsNeedingHousekeeping: input.rooms.filter((room) => room.housekeepingStatus === "open" || room.housekeepingStatus === "in_progress").length,
    openMaintenance: input.maintenance.filter((ticket) => !["resolved", "closed"].includes(ticket.status)).length,
    activeReservations: input.reservations.filter((reservation) => ["confirmed", "checked_in"].includes(reservation.status)).length,
    openOrders: input.orders.filter((order) => !["paid", "cancelled"].includes(order.status)).length,
    ordersInPreparation: input.orders.filter((order) => order.status === "in_preparation").length,
    deliveredOrders: input.orders.filter((order) => order.status === "delivered").length,
    billedOrders: input.orders.filter((order) => order.status === "billed").length,
    paidOrders: input.orders.filter((order) => order.status === "paid").length,
    occupancyRate: totalRooms ? Math.round((occupiedRooms / totalRooms) * 100) : 0,
    outletRevenue: input.orders.filter((order) => order.status === "paid").reduce((sum, order) => sum + order.total, 0),
  };
}
