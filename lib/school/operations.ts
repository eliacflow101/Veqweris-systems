export type SchoolOperationalArea = "library" | "transport" | "hostel" | "health" | "welfare" | "safeguarding";

export type SchoolSensitivity = "standard" | "sensitive" | "highly_sensitive";

export interface SchoolOperationalRecord {
  recordId: string;
  institutionId: string;
  area: SchoolOperationalArea;
  status: string;
  sensitivity: SchoolSensitivity;
  createdBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface LibraryLoan {
  loanId: string;
  institutionId: string;
  studentId: string;
  copyId: string;
  status: "issued" | "returned" | "overdue" | "lost" | "damaged";
  issuedAt: unknown;
  dueAt: unknown;
  returnedAt?: unknown;
}

export interface TransportRoute {
  routeId: string;
  institutionId: string;
  name: string;
  driverId?: string | null;
  vehicleId?: string | null;
  pickupPointIds: string[];
  status: "draft" | "active" | "maintenance";
}

export interface HostelRoom {
  roomId: string;
  institutionId: string;
  houseId: string;
  name: string;
  capacity: number;
  occupied: number;
  status: "available" | "full" | "maintenance";
}

export function canAccessSchoolArea(input: {
  area: SchoolOperationalArea;
  role: string;
  moduleEnabled: boolean;
  sensitivity: SchoolSensitivity;
  hasSensitivePermission: boolean;
}) {
  if (!input.moduleEnabled) return { allowed: false, reason: "Module is not enabled." };
  if (input.sensitivity !== "standard" && !input.hasSensitivePermission) return { allowed: false, reason: "Sensitive permission is required." };
  const roleAreas: Record<string, SchoolOperationalArea[]> = {
    Owner: ["library", "transport", "hostel", "health", "welfare", "safeguarding"],
    Admin: ["library", "transport", "hostel", "health", "welfare", "safeguarding"],
    Manager: ["library", "transport", "hostel"],
    Employee: [],
    Librarian: ["library"],
    "Transport Officer": ["transport"],
    Warden: ["hostel"],
    Counselor: ["welfare"],
    Teacher: [],
    Student: [],
    Guardian: [],
  };
  const allowed = roleAreas[input.role]?.includes(input.area) ?? false;
  return { allowed, reason: allowed ? "allowed" : "Role is not permitted for this school area." };
}

export function calculateHostelOccupancy(capacity: number, occupied: number) {
  if (capacity < 0 || occupied < 0) throw new Error("Occupancy values must be non-negative.");
  return { capacity, occupied, available: Math.max(capacity - occupied, 0), full: occupied >= capacity };
}
