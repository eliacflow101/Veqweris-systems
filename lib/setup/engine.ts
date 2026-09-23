import type { DepartmentRecommendation, SetupConfig, SetupEvidence, SetupModule, SetupProgress, SetupRequirement, SetupState } from "./models";

const baseRequirements: Array<Omit<SetupRequirement, "institutionId" | "state"> & { state?: SetupState }> = [
  { requirementId: "institution-profile", dimension: "Institution", title: "Complete institution profile", description: "Confirm the institution name, country, and operating details.", module: "generic", order: 1, verificationKey: "institutionProfile" },
  { requirementId: "security-owner", dimension: "Security", title: "Confirm owner and security policy", description: "Verify the owner account, sessions, and sensitive-action controls.", module: "generic", order: 2, verificationKey: "securityOwner" },
  { requirementId: "users-admin", dimension: "Users", title: "Invite administrators and managers", description: "Ensure accountable users can operate the workspace.", module: "generic", order: 3, verificationKey: "usersAdmin" },
  { requirementId: "operational-departments", dimension: "Operational", title: "Review departments", description: "Confirm the recommended department structure.", module: "generic", order: 4, verificationKey: "departments" },
  { requirementId: "module-selection", dimension: "Modules", title: "Select enabled modules", description: "Choose only the modules this institution operates.", module: "generic", order: 5, verificationKey: "moduleSelection" },
  { requirementId: "integration-review", dimension: "Integrations", title: "Review integrations", description: "Verify external integrations before connecting them.", module: "generic", order: 6, verificationKey: "integrations" },
  { requirementId: "school-structure", dimension: "Modules", title: "Configure academic structure", description: "Set academic years, levels, classes, and subjects.", module: "school", order: 20, verificationKey: "schoolStructure" },
  { requirementId: "school-staff", dimension: "Users", title: "Review teaching staff", description: "Assign school roles and permissions.", module: "school", order: 21, verificationKey: "schoolStaff" },
  { requirementId: "hospital-care-model", dimension: "Operational", title: "Configure care departments", description: "Confirm clinical departments and care-team access.", module: "hospital", order: 20, verificationKey: "hospitalCare" },
  { requirementId: "hospital-privacy", dimension: "Security", title: "Verify clinical privacy controls", description: "Review sensitive record access and break-glass policy.", module: "hospital", order: 21, verificationKey: "hospitalPrivacy" },
  { requirementId: "hotel-operations", dimension: "Operational", title: "Configure hotel operations", description: "Confirm rooms, housekeeping, maintenance, and outlets.", module: "hotel", order: 20, verificationKey: "hotelOperations" },
  { requirementId: "hotel-front-desk", dimension: "Users", title: "Review front desk access", description: "Assign reception and service roles.", module: "hotel", order: 21, verificationKey: "hotelStaff" },
];

export function defaultSetupConfig(institutionId: string, institutionType: SetupModule = "generic"): SetupConfig {
  return { institutionId, institutionType, enabledModules: institutionType === "generic" ? [] : [institutionType] };
}

export function buildSetupRequirements(institutionId: string, config: SetupConfig, existing: SetupRequirement[] = []): SetupRequirement[] {
  const saved = new Map(existing.map((item) => [item.requirementId, item]));
  return baseRequirements
    .filter((item) => item.module === "generic" || config.enabledModules.includes(item.module))
    .map((item) => {
      const previous = saved.get(item.requirementId);
      return { ...item, institutionId, state: previous?.state ?? item.state ?? (item.module === "generic" ? "Required" : "Recommended"), ...previous, verificationKey: item.verificationKey };
    })
    .sort((a, b) => a.order - b.order);
}

export function evaluateSetupRequirements(requirements: SetupRequirement[], config: SetupConfig, evidence: SetupEvidence, now = new Date().toISOString()): SetupRequirement[] {
  const checks: Record<string, [boolean, string]> = {
    institutionProfile: [evidence.institutionExists && evidence.institutionProfileComplete, "Institution profile must include name and country."],
    securityOwner: [evidence.activeUsers.some((user) => user.role === "Owner" && user.status !== "inactive"), "An active owner account is required."],
    usersAdmin: [evidence.activeUsers.filter((user) => ["Owner", "Admin", "Manager"].includes(user.role ?? "")).length >= 2, "At least two active accountable users are required."],
    departments: [evidence.departmentCount > 0, "At least one department is required."],
    moduleSelection: [config.enabledModules.length > 0 || config.institutionType === "generic", "Select at least one enabled module or use the generic workspace."],
    integrations: [true, "No external integration is required for core readiness."],
    schoolStructure: [["academicYears", "academicLevels", "schoolClasses", "schoolSubjects"].every((key) => (evidence.collections[key] ?? 0) > 0), "Academic years, levels, classes, and subjects are required."],
    schoolStaff: [evidence.activeUsers.length > 1, "At least two active users are required for school operations."],
    hospitalCare: [evidence.departmentCount > 0 && evidence.activeUsers.some((user) => ["Clinician", "Nurse"].includes(user.role ?? "")), "A care department and clinical user are required."],
    hospitalPrivacy: [evidence.activeUsers.some((user) => ["Owner", "Admin"].includes(user.role ?? "")), "An active owner or administrator is required for privacy controls."],
    hotelOperations: [(evidence.collections.hotelRooms ?? 0) > 0, "At least one hotel room must be configured."],
    hotelStaff: [evidence.activeUsers.some((user) => ["Reception", "Manager", "Owner", "Admin"].includes(user.role ?? "")), "A front-desk or accountable user is required."],
  };
  return requirements.map((requirement) => {
    const check = requirement.verificationKey ? checks[requirement.verificationKey] : undefined;
    if (!check) return requirement;
    const [satisfied, reason] = check;
    return { ...requirement, state: satisfied ? "Completed" : (requirement.state === "Blocked" ? "Blocked" : "Required"), verification: { satisfied, reason, checkedAt: now } };
  });
}

export function calculateSetupProgress(requirements: SetupRequirement[]): SetupProgress {
  const requiredItems = requirements.filter((item) => item.state === "Required" || item.state === "Needs Verification" || item.state === "Completed");
  const completed = requirements.filter((item) => item.state === "Completed").length;
  const requiredCompleted = requiredItems.filter((item) => item.state === "Completed").length;
  const percent = requirements.length ? Math.round((completed / requirements.length) * 100) : 0;
  const readiness = requiredItems.some((item) => item.state === "Needs Verification") ? "Ready for Verification"
    : requiredItems.length > 0 && requiredCompleted === requiredItems.length ? (completed === requirements.length ? "Ready" : "Ready for Verification")
      : completed > 0 ? "In Progress" : "Not Ready";
  return { total: requirements.length, completed, required: requiredItems.length, requiredCompleted, percent, readiness };
}

export function transitionSetupRequirement(requirement: SetupRequirement, state: SetupState, actor?: string): SetupRequirement {
  if (state === "Completed") throw new Error("Completed is derived from verified institution data and cannot be set manually.");
  return { ...requirement, state, ...(actor ? { reviewedBy: actor, reviewedAt: new Date().toISOString() } : {}) };
}

export function recommendDepartments(module: SetupModule): DepartmentRecommendation[] {
  const recommendations: Record<SetupModule, Array<[string, string]>> = {
    generic: [["Administration", "Core institution administration and governance."], ["Operations", "Coordinate daily operational work."]],
    school: [["Academic Affairs", "Coordinate curriculum, classes, and assessments."], ["Student Services", "Support admissions, attendance, and student wellbeing."]],
    hospital: [["Clinical Services", "Coordinate care teams and clinical workflows."], ["Front Office", "Coordinate reception, scheduling, and billing."]],
    hotel: [["Front Office", "Coordinate reservations, reception, and guest services."], ["Housekeeping", "Coordinate room readiness and service operations."]],
  };
  return recommendations[module].map(([name, reason]) => ({ recommendationId: `${module}-${name.toLowerCase().replaceAll(" ", "-")}`, name, reason, module, state: "Recommended" }));
}
