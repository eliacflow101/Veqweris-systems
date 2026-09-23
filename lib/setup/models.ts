export const setupDimensions = ["Institution", "Security", "Users", "Operational", "Modules", "Integrations"] as const;
export type SetupDimension = (typeof setupDimensions)[number];
export type SetupState = "Required" | "Recommended" | "Optional" | "Blocked" | "Completed" | "Needs Verification";
export type SetupModule = "generic" | "school" | "hospital" | "hotel";

export interface SetupRequirement {
  requirementId: string;
  institutionId: string;
  dimension: SetupDimension;
  title: string;
  description: string;
  state: SetupState;
  module: SetupModule;
  order: number;
  verificationKey?: string;
  metadata?: Record<string, unknown>;
  reviewedAt?: string;
  reviewedBy?: string;
  verification?: { satisfied: boolean; reason: string; checkedAt: string };
}

export interface SetupConfig {
  institutionId: string;
  institutionType: SetupModule;
  enabledModules: SetupModule[];
  updatedAt?: unknown;
}

export interface DepartmentRecommendation {
  recommendationId: string;
  name: string;
  reason: string;
  module: SetupModule;
  state: "Recommended" | "Accepted" | "Dismissed" | "Needs Review";
}

export interface SetupProgress {
  total: number;
  completed: number;
  required: number;
  requiredCompleted: number;
  percent: number;
  readiness: "Not Ready" | "In Progress" | "Ready for Verification" | "Ready";
}

export interface SetupSnapshot {
  config: SetupConfig;
  requirements: SetupRequirement[];
  recommendations: DepartmentRecommendation[];
  progress: SetupProgress;
}

export interface SetupEvidence {
  institutionExists: boolean;
  institutionProfileComplete: boolean;
  activeUsers: Array<{ role?: string; status?: string }>;
  departmentCount: number;
  collections: Record<string, number>;
}
