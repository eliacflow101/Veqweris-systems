export type InventoryStatus =
  | "Verified Stock"
  | "Partially Known"
  | "Awaiting Confirmation"
  | "Untracked"
  | "Conflicting";

export type StockMovementType =
  | "Receiving"
  | "Issue"
  | "Consumption"
  | "Transfer"
  | "Reservation"
  | "Release"
  | "Return"
  | "Waste"
  | "Adjustment"
  | "Expiry"
  | "Quarantine";

export type ReservationState =
  | "Required"
  | "Requested"
  | "Confirmed"
  | "Reserved"
  | "Consumed"
  | "Released";

export type ResourceState =
  | "Verified Ready"
  | "Known but Unverified"
  | "Maintenance Due"
  | "Restricted"
  | "Untracked";

export type InventoryAlert =
  | "low_stock"
  | "critical_stock"
  | "consumption_trend"
  | "unusual_consumption"
  | "expiry"
  | "waste"
  | "slow_moving"
  | "dead_stock"
  | "reservation_conflict"
  | "location_imbalance"
  | "replenishment_required"
  | "variance_exception";

export type ProcurementStatus = "Request" | "Approved" | "Supplier Selected" | "Purchased" | "Received" | "Reconciled" | "Rejected";

export type ProcurementRequest = {
  requestId: string;
  institutionId: string;
  module: string;
  departmentId: string | null;
  supplierId: string | null;
  itemId: string | null;
  quantity: number;
  status: ProcurementStatus;
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string | null;
  approvalRequired: boolean;
};

export type InventoryItem = {
  id: string;
  institutionId: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  currentQuantity: number;
  minimumLevel: number;
  safetyLevel: number;
  leadTimeDays: number;
  locationId: string;
  supplierId: string | null;
  tracked: boolean;
  reservedQuantity: number;
  availableQuantity: number;
  status: InventoryStatus;
  expiryDate?: string | null;
  restricted?: boolean;
  lastMovementAt?: string | null;
  lastConsumedAt?: string | null;
};

export type StockMovement = {
  movementId: string;
  itemId: string;
  institutionId: string;
  type: StockMovementType;
  previousQuantity: number;
  movementQuantity: number;
  newQuantity: number;
  actorUid: string;
  timestamp: string;
  sourceEvent: string;
  reason: string;
  approvalRequired: boolean;
  approvalStatus?: string;
};

export type InventoryReservation = {
  reservationId: string;
  itemId: string;
  institutionId: string;
  requestedQuantity: number;
  status: ReservationState;
  verified: boolean;
  actorUid: string;
  createdAt: string;
  updatedAt: string;
};

export type ResourceRecord = {
  id: string;
  institutionId: string;
  name: string;
  type: string;
  locationId: string;
  capacity: number;
  occupied: number;
  status: ResourceState;
  maintenanceDueAt?: string | null;
  restricted?: boolean;
};

export type ReconciliationResult = {
  variance: number;
  status: "No Exception" | "Potential Inventory Variance" | "Inventory Reconciliation Exception";
  expected: number;
  actual: number;
  action: "No action" | "Human Verification" | "Escalate";
};

export function evaluateInventoryStatus(item: Pick<InventoryItem, "currentQuantity" | "minimumLevel" | "safetyLevel" | "tracked" | "status" | "restricted">): InventoryStatus {
  if (item.restricted) return "Conflicting";
  if (!item.tracked) return "Untracked";
  if (item.currentQuantity < 0) return "Conflicting";
  if (item.currentQuantity === 0) return "Awaiting Confirmation";
  if (item.currentQuantity <= item.minimumLevel) return "Partially Known";
  if (item.currentQuantity <= item.safetyLevel) return "Awaiting Confirmation";
  return item.status || "Verified Stock";
}

export function createInventoryItem(input: Partial<InventoryItem> & Pick<InventoryItem, "id" | "institutionId" | "name" | "sku" | "category" | "unit" | "currentQuantity" | "minimumLevel" | "safetyLevel" | "locationId" | "tracked">): InventoryItem {
  const item: InventoryItem = {
    supplierId: null,
    leadTimeDays: 7,
    reservedQuantity: 0,
    availableQuantity: input.currentQuantity ?? 0,
    status: "Verified Stock",
    restricted: false,
    expiryDate: null,
    lastMovementAt: new Date().toISOString(),
    lastConsumedAt: null,
    ...input,
  };
  item.status = evaluateInventoryStatus(item);
  item.availableQuantity = Math.max(item.currentQuantity - item.reservedQuantity, 0);
  return item;
}

export function createInventoryMovement(input: Omit<StockMovement, "movementId" | "timestamp"> & { movementId?: string; timestamp?: string }): StockMovement {
  return {
    movementId: input.movementId ?? `movement-${Date.now()}`,
    itemId: input.itemId,
    institutionId: input.institutionId,
    type: input.type,
    previousQuantity: input.previousQuantity,
    movementQuantity: input.movementQuantity,
    newQuantity: input.newQuantity,
    actorUid: input.actorUid,
    timestamp: input.timestamp ?? new Date().toISOString(),
    sourceEvent: input.sourceEvent,
    reason: input.reason,
    approvalRequired: input.approvalRequired,
    approvalStatus: input.approvalStatus ?? (input.approvalRequired ? "Pending" : "Not Required"),
  };
}

export function getReservationState(available: number, requested: number, verified: boolean): ReservationState {
  if (requested <= 0) return "Required";
  if (!verified) return "Requested";
  if (requested <= Math.max(available, 0)) return "Confirmed";
  if (requested > Math.max(available, 0)) return "Reserved";
  return "Confirmed";
}

export function createReservation(input: Omit<InventoryReservation, "reservationId" | "createdAt" | "updatedAt"> & { reservationId?: string; createdAt?: string; updatedAt?: string }): InventoryReservation {
  const status = getReservationState(input.requestedQuantity, input.requestedQuantity, input.verified);
  return {
    reservationId: input.reservationId ?? `reservation-${Date.now()}`,
    itemId: input.itemId,
    institutionId: input.institutionId,
    requestedQuantity: input.requestedQuantity,
    status,
    verified: input.verified,
    actorUid: input.actorUid,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

export function evaluateResourceState(resource: Pick<ResourceRecord, "capacity" | "occupied" | "status" | "restricted" | "maintenanceDueAt">): ResourceState {
  if (resource.restricted) return "Restricted";
  if (resource.maintenanceDueAt && new Date(resource.maintenanceDueAt).getTime() <= Date.now()) return "Maintenance Due";
  if (resource.capacity <= 0) return "Untracked";
  if (resource.occupied > resource.capacity) return "Restricted";
  if (resource.status === "Verified Ready") return "Verified Ready";
  return resource.status || "Known but Unverified";
}

export function createResource(input: Partial<ResourceRecord> & Pick<ResourceRecord, "id" | "institutionId" | "name" | "type" | "locationId" | "capacity" | "occupied">): ResourceRecord {
  const result: ResourceRecord = {
    restricted: false,
    maintenanceDueAt: null,
    status: "Verified Ready",
    ...input,
  };
  result.status = evaluateResourceState(result);
  return result;
}

export function getInventoryAlerts(item: InventoryItem): Array<{ type: InventoryAlert; message: string }> {
  const alerts: Array<{ type: InventoryAlert; message: string }> = [];
  const lowThreshold = item.currentQuantity <= item.minimumLevel;
  const criticalThreshold = item.currentQuantity <= item.safetyLevel;
  if (lowThreshold) alerts.push({ type: "low_stock", message: `${item.name} has reached or fallen below minimum stock.` });
  if (criticalThreshold) alerts.push({ type: "critical_stock", message: `${item.name} is near its safety threshold and needs replenishment.` });
  if (item.lastConsumedAt && item.currentQuantity <= item.minimumLevel) alerts.push({ type: "replenishment_required", message: `Replenishment is required for ${item.name} before lead time expiration.` });
  if (item.expiryDate && new Date(item.expiryDate).getTime() <= Date.now() + 14 * 24 * 60 * 60 * 1000) alerts.push({ type: "expiry", message: `${item.name} is nearing expiry.` });
  if (item.reservedQuantity > item.currentQuantity) alerts.push({ type: "reservation_conflict", message: `Reservation exceeds available stock for ${item.name}.` });
  if (item.currentQuantity <= 0) alerts.push({ type: "unusual_consumption", message: `${item.name} is below zero or in a consumption anomaly.` });
  return alerts;
}

export function reconcileExpectedVsActual(expected: number, actual: number, tolerance = 0): ReconciliationResult {
  const variance = actual - expected;
  if (Math.abs(variance) <= tolerance) {
    return { variance, status: "No Exception", expected, actual, action: "No action" };
  }
  if (Math.abs(variance) > 0 && Math.abs(variance) <= 2) {
    return { variance, status: "Potential Inventory Variance", expected, actual, action: "Human Verification" };
  }
  return { variance, status: "Inventory Reconciliation Exception", expected, actual, action: "Escalate" };
}

export function detectResourceConflicts(resources: ResourceRecord[], bookings: Array<{ resourceId: string; start: string; end: string }>) {
  const conflicts: Array<{ resourceId: string; reason: string; alternative: string }> = [];
  for (const booking of bookings) {
    const resource = resources.find((entry) => entry.id === booking.resourceId);
    if (!resource) continue;
    const isMaintenanceConflict = resource.status === "Maintenance Due" || (resource.maintenanceDueAt && new Date(resource.maintenanceDueAt).getTime() <= Date.now());
    const isCapacityConflict = resource.occupied > resource.capacity;
    if (resource.status === "Restricted" || isMaintenanceConflict || isCapacityConflict) {
      conflicts.push({
        resourceId: booking.resourceId,
        reason: "resource unavailable",
        alternative: `Use a different ${resource.type.toLowerCase()} or reschedule the booking.`,
      });
    }
  }
  return conflicts;
}

export function createProcurementRequest(input: Omit<ProcurementRequest, "requestId" | "requestedAt"> & { requestId?: string; requestedAt?: string }): ProcurementRequest {
  return {
    requestId: input.requestId ?? `procurement-${Date.now()}`,
    institutionId: input.institutionId,
    module: input.module,
    departmentId: input.departmentId,
    supplierId: input.supplierId,
    itemId: input.itemId,
    quantity: input.quantity,
    status: input.status ?? "Request",
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt ?? new Date().toISOString(),
    approvedBy: input.approvedBy ?? null,
    approvalRequired: input.approvalRequired,
  };
}

export function createInventoryScenario(name: string, institutionId: string, currentQuantity: number, minimumLevel: number, safetyLevel: number, unit = "units", category = "general") {
  return createInventoryItem({
    id: `item-${name.toLowerCase().replace(/\s+/g, "-")}`,
    institutionId,
    name,
    sku: `SKU-${name.toLowerCase().replace(/\s+/g, "-")}`,
    category,
    unit,
    currentQuantity,
    minimumLevel,
    safetyLevel,
    locationId: "loc-primary",
    supplierId: "supplier-1",
    tracked: true,
    reservedQuantity: 0,
    restricted: false,
    expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
}
