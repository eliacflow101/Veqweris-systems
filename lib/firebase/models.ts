export type UserRole = "Owner" | "Admin" | "Manager" | "Employee";

export interface Institution {
  institutionId: string;
  name: string;
  country: string;
  status: "active";
  planTier: "trial";
  createdAt: unknown;
}

export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  institutionId: string;
  departmentId: string | null;
  lastActive: unknown;
  role: UserRole;
  status: "active" | "inactive";
  createdAt: unknown;
}

export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";

export interface Department {
  departmentId: string;
  institutionId: string;
  name: string;
  departmentCode: string;
  headUserId: string | null;
  description: string;
  status: "active" | "inactive";
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Task {
  taskId: string;
  institutionId: string;
  departmentId: string;
  title: string;
  description: string;
  assignedTo: string;
  assignedBy: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}
