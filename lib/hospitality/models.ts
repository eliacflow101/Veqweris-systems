export type RoomStatus = "available" | "occupied" | "housekeeping" | "maintenance" | "out_of_service";
export type ReservationStatus = "inquiry" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show";
export type GuestStatus = "active" | "checked_in" | "checked_out" | "blocked";
export type HousekeepingStatus = "open" | "in_progress" | "inspected" | "completed" | "cancelled";
export type MaintenanceStatus = "reported" | "assigned" | "in_progress" | "resolved" | "closed";
export type OutletType = "restaurant" | "bar" | "room_service" | "spa" | "other";
export type HospitalityOrderType = "outlet" | "room_service";
export type HospitalityOrderStatus =
  | "received" | "confirmed" | "in_preparation" | "ready"
  | "out_for_delivery" | "delivered" | "billed" | "paid" | "cancelled";

export interface HotelRoomType {
  roomTypeId: string;
  institutionId: string;
  name: string;
  description?: string;
  capacity: number;
  baseRate: number;
  currency: string;
  amenities: string[];
  active: boolean;
}

export interface HotelRoom {
  roomId: string;
  institutionId: string;
  roomNumber: string;
  roomTypeId: string;
  floor?: string | null;
  status: RoomStatus;
  housekeepingStatus?: HousekeepingStatus | null;
  maintenanceStatus?: MaintenanceStatus | null;
}

export interface HotelGuest {
  guestId: string;
  institutionId: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  identityReference?: string | null;
  status: GuestStatus;
  createdAt: unknown;
}

export interface HotelReservation {
  reservationId: string;
  institutionId: string;
  guestId: string;
  roomId: string;
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  status: ReservationStatus;
  billId?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}

export type ReservationTransition = "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show";

export interface HousekeepingTask {
  taskId: string;
  institutionId: string;
  roomId: string;
  reservationId?: string | null;
  taskType: "cleaning" | "inspection" | "turndown" | "linen" | "other";
  status: HousekeepingStatus;
  assignedTo?: string | null;
  notes?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface MaintenanceTicket {
  ticketId: string;
  institutionId: string;
  roomId?: string | null;
  outletId?: string | null;
  description: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: MaintenanceStatus;
  assignedTo?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface HospitalityOutlet {
  outletId: string;
  institutionId: string;
  name: string;
  type: OutletType;
  active: boolean;
  location?: string | null;
}

export interface HospitalityOrderItem {
  itemId: string;
  name: string;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
  inventoryItemId?: string | null;
}

export interface HospitalityOrder {
  orderId: string;
  institutionId: string;
  orderType: HospitalityOrderType;
  outletId: string;
  roomId?: string | null;
  guestId?: string | null;
  reservationId?: string | null;
  items: HospitalityOrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  status: HospitalityOrderStatus;
  inventoryReservationIds: string[];
  billId?: string | null;
  paymentId?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface HospitalityDashboardMetrics {
  totalRooms: number;
  availableRooms: number;
  occupiedRooms: number;
  roomsNeedingHousekeeping: number;
  openMaintenance: number;
  activeReservations: number;
  openOrders: number;
  ordersInPreparation: number;
  deliveredOrders: number;
  billedOrders: number;
  paidOrders: number;
  occupancyRate: number;
  outletRevenue: number;
}

/** A reference to the shared inventory engine, never a second inventory ledger. */
export interface InventoryDeductionReference {
  inventoryItemId: string;
  quantity: number;
  reservationId?: string | null;
  movementId?: string | null;
}
