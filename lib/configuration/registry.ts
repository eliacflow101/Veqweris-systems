import { SYSTEM_ROLE_TEMPLATES } from "@/lib/permissions/registry";
import { coreModuleIds } from "@/lib/platform/models";

export type InstitutionTypeCode =
  | "nursery" | "primary" | "secondary" | "mixed-school" | "college" | "university"
  | "hospital" | "clinic" | "pharmacy" | "diagnostic-laboratory"
  | "hotel" | "restaurant" | "lodge"
  | "supermarket" | "retail-shop" | "wholesale" | "mixed-business"
  | "general-business" | "ngo" | "government-service-center" | "financial-service" | "manufacturing";

export type InstitutionCategory = "Education" | "Health" | "Hospitality" | "Commerce" | "General";

export interface InstitutionTypeDefinition {
  code: InstitutionTypeCode;
  category: InstitutionCategory;
  type: string;
  subtype: string;
  label: string;
  packId: string;
  defaultModules: string[];
  version: 1;
  generalPackNotice?: string;
}

export interface ConfigurationPack {
  packId: string;
  version: 1;
  departments: string[];
  operationalUnits: string[];
  roleTemplateIds: string[];
  taskCategories: string[];
  workflows: string[];
  statuses: string[];
  setupChecklist: string[];
}

export interface ModuleDefinition {
  id: string;
  label: string;
  category: "core" | "vertical" | "optional";
  dependencies: string[];
  conflicts: string[];
  entitlementKey: string;
}

const CORE_MODULES = [...coreModuleIds];
const generalPackNotice = "This institution uses the General configuration. Deeper vertical features are available in a future stage.";
const templateIds = new Set<string>(SYSTEM_ROLE_TEMPLATES.map((template) => template.templateId));

export const INSTITUTION_TYPES: readonly InstitutionTypeDefinition[] = [
  { code: "nursery", category: "Education", type: "Education", subtype: "Nursery/Kindergarten", label: "Nursery / Kindergarten", packId: "school-nursery", defaultModules: [...CORE_MODULES, "school"], version: 1 },
  { code: "primary", category: "Education", type: "Education", subtype: "Primary", label: "Primary School", packId: "school-primary", defaultModules: [...CORE_MODULES, "school"], version: 1 },
  { code: "secondary", category: "Education", type: "Education", subtype: "Secondary", label: "Secondary School", packId: "school-secondary", defaultModules: [...CORE_MODULES, "school"], version: 1 },
  { code: "mixed-school", category: "Education", type: "Education", subtype: "Mixed (Primary+Secondary)", label: "Mixed School", packId: "school-mixed", defaultModules: [...CORE_MODULES, "school"], version: 1 },
  { code: "college", category: "Education", type: "Education", subtype: "College", label: "College", packId: "school-college", defaultModules: [...CORE_MODULES, "school"], version: 1 },
  { code: "university", category: "Education", type: "Education", subtype: "University", label: "University", packId: "school-university", defaultModules: [...CORE_MODULES, "school"], version: 1 },
  { code: "hospital", category: "Health", type: "Health", subtype: "Hospital", label: "Hospital", packId: "health-hospital", defaultModules: [...CORE_MODULES, "healthcare", "inventory", "hospital-laboratory"], version: 1 },
  { code: "clinic", category: "Health", type: "Health", subtype: "Clinic", label: "Clinic", packId: "health-clinic", defaultModules: [...CORE_MODULES, "healthcare"], version: 1 },
  { code: "pharmacy", category: "Health", type: "Health", subtype: "Pharmacy", label: "Pharmacy", packId: "health-pharmacy", defaultModules: [...CORE_MODULES, "pharmacy"], version: 1 },
  { code: "diagnostic-laboratory", category: "Health", type: "Health", subtype: "Diagnostic Laboratory", label: "Diagnostic Laboratory", packId: "health-laboratory", defaultModules: [...CORE_MODULES, "healthcare", "hospital-laboratory"], version: 1 },
  { code: "hotel", category: "Hospitality", type: "Hospitality", subtype: "Hotel", label: "Hotel", packId: "hospitality-hotel", defaultModules: [...CORE_MODULES, "hospitality", "inventory", "room-service"], version: 1 },
  { code: "restaurant", category: "Hospitality", type: "Hospitality", subtype: "Restaurant", label: "Restaurant", packId: "hospitality-restaurant", defaultModules: [...CORE_MODULES, "hospitality", "kitchen", "inventory"], version: 1 },
  { code: "lodge", category: "Hospitality", type: "Hospitality", subtype: "Lodge/Guest House", label: "Lodge / Guest House", packId: "hospitality-lodge", defaultModules: [...CORE_MODULES, "hospitality"], version: 1 },
  { code: "supermarket", category: "Commerce", type: "Commerce", subtype: "Supermarket", label: "Supermarket", packId: "commerce-supermarket", defaultModules: [...CORE_MODULES, "hospitality", "inventory"], version: 1 },
  { code: "retail-shop", category: "Commerce", type: "Commerce", subtype: "Retail Shop", label: "Retail Shop", packId: "commerce-retail", defaultModules: [...CORE_MODULES, "hospitality", "inventory"], version: 1 },
  { code: "wholesale", category: "Commerce", type: "Commerce", subtype: "Wholesale", label: "Wholesale", packId: "commerce-wholesale", defaultModules: [...CORE_MODULES, "wholesale"], version: 1 },
  { code: "mixed-business", category: "Commerce", type: "Commerce", subtype: "Mixed Business", label: "Mixed Business", packId: "commerce-mixed", defaultModules: [...CORE_MODULES, "hospitality", "inventory"], version: 1 },
  { code: "general-business", category: "General", type: "General", subtype: "General Business", label: "General Business", packId: "general", defaultModules: [...CORE_MODULES], version: 1, generalPackNotice },
  { code: "ngo", category: "General", type: "General", subtype: "NGO", label: "NGO", packId: "general", defaultModules: [...CORE_MODULES], version: 1, generalPackNotice },
  { code: "government-service-center", category: "General", type: "General", subtype: "Government Service Center", label: "Government Service Center", packId: "general", defaultModules: [...CORE_MODULES], version: 1, generalPackNotice },
  { code: "financial-service", category: "General", type: "General", subtype: "Financial Service", label: "Financial Service", packId: "general", defaultModules: [...CORE_MODULES], version: 1, generalPackNotice },
  { code: "manufacturing", category: "General", type: "General", subtype: "Manufacturing", label: "Manufacturing", packId: "general", defaultModules: [...CORE_MODULES], version: 1, generalPackNotice },
];

const roleSets = {
  education: ["teacher", "admissions-officer", "librarian", "transport-officer", "warden", "counselor", "department-head"],
  health: ["pharmacist", "nurse", "lab-technician", "doctor-clinician", "finance-officer", "storekeeper"],
  hospitality: ["receptionist", "housekeeping", "kitchen-staff", "cashier", "procurement-officer", "department-head"],
  commerce: ["pos-operator", "cashier", "storekeeper", "procurement-officer", "finance-officer", "auditor"],
  general: ["finance-officer", "storekeeper", "receptionist", "auditor"],
} as const;

function pack(
  packId: string,
  departments: string[],
  operationalUnits: string[],
  roleTemplateIds: readonly string[],
  taskCategories: string[],
  workflows: string[],
): ConfigurationPack {
  return {
    packId,
    version: 1,
    departments,
    operationalUnits,
    roleTemplateIds: roleTemplateIds.filter((id) => templateIds.has(id)),
    taskCategories,
    workflows,
    statuses: ["active", "inactive", "pending", "in_progress", "completed", "cancelled"],
    setupChecklist: ["add-people", "confirm-departments", "review-roles", "set-branding", "configure-workflow", "import-data", "configure-payments"],
  };
}

const schoolDepartments = {
  nursery: ["Early Years", "Learning & Development", "Care & Safeguarding", "Administration", "Finance"],
  primary: ["Teaching & Learning", "Student Services", "Library", "Administration", "Finance"],
  secondary: ["Academic Affairs", "Sciences", "Humanities", "Student Services", "Administration", "Finance"],
  mixed: ["Early Years", "Primary Education", "Secondary Education", "Student Services", "Administration", "Finance"],
  college: ["Academic Affairs", "Admissions", "Student Services", "Library & Learning Resources", "Administration", "Finance"],
  university: ["Faculties", "Admissions & Registry", "Research", "Student Affairs", "Library", "Administration", "Finance"],
} as const;

export const CONFIGURATION_PACKS: Readonly<Record<string, ConfigurationPack>> = Object.freeze({
  "health-hospital": pack("health-hospital", ["Reception & Registration", "Triage/Emergency", "Outpatient", "Inpatient Wards", "Laboratory", "Radiology/Imaging", "Pharmacy", "Theatre/Procedures", "Maternity", "Billing & Insurance Desk", "Medical Records", "Stores/Supplies", "Housekeeping", "Maintenance/Biomedical", "Administration", "Human Resources", "Finance"], ["Reception", "Emergency", "Outpatient", "Ward", "Laboratory", "Radiology", "Pharmacy", "Theatre"], roleSets.health, ["clinical", "maintenance", "inventory"], ["patient-registration", "clinical-care", "billing"]),
  "health-clinic": pack("health-clinic", ["Reception", "Consultation", "Nursing/Procedures", "Dispensary", "Billing", "Records", "Administration"], ["Reception", "Consultation", "Nursing", "Dispensary"], roleSets.health, ["clinical", "inventory"], ["patient-registration", "consultation", "billing"]),
  "health-pharmacy": pack("health-pharmacy", ["Dispensing", "Prescription Verification", "Inventory & Purchasing", "Customer Service/Counter", "Sales & Billing", "Administration"], ["Dispensing", "Prescription Verification", "Stockroom", "Counter"], roleSets.health, ["stock", "dispensing", "purchasing"], ["prescription-verification", "stock-controlled-dispensing"]),
  "health-laboratory": pack("health-laboratory", ["Sample Reception", "Testing", "Verification & Release", "Quality", "Stores", "Billing", "Administration"], ["Sample Reception", "Testing", "Verification", "Quality Control"], roleSets.health, ["samples", "quality", "stock"], ["sample-lifecycle", "result-verification"]),
  "hospitality-hotel": pack("hospitality-hotel", ["Front Office", "Housekeeping", "Maintenance", "Food & Beverage", "Restaurant", "Kitchen", "Room Service", "Bar", "Events", "Stores", "Procurement", "Finance", "Human Resources", "Security", "Administration"], ["Front Office", "Housekeeping", "Maintenance", "Restaurant", "Kitchen", "Room Service", "Stores"], roleSets.hospitality, ["guest-service", "housekeeping", "maintenance", "stock"], ["guest-stay", "room-service", "billing"]),
  "hospitality-restaurant": pack("hospitality-restaurant", ["Front of House", "Kitchen", "Bar", "Stores", "Cashier", "Procurement", "Administration"], ["Front of House", "Kitchen", "Bar", "Stores"], roleSets.hospitality, ["service", "kitchen", "stock"], ["order-to-service", "billing"]),
  "hospitality-lodge": pack("hospitality-lodge", ["Front Office", "Housekeeping", "Maintenance", "Stores", "Administration", "Finance"], ["Front Office", "Housekeeping", "Maintenance", "Stores"], roleSets.hospitality, ["guest-service", "housekeeping", "maintenance"], ["guest-stay", "billing"]),
  "commerce-supermarket": pack("commerce-supermarket", ["Sales Floor/POS", "Stores & Receiving", "Inventory Control", "Customer Service", "Purchasing", "Finance", "Administration"], ["Sales Floor", "POS", "Receiving", "Inventory Control"], roleSets.commerce, ["sales", "receiving", "stock", "purchasing"], ["point-of-sale", "replenishment"]),
  "commerce-retail": pack("commerce-retail", ["Sales Floor/POS", "Stores & Receiving", "Inventory Control", "Customer Service", "Purchasing", "Finance", "Administration"], ["Sales Floor", "POS", "Receiving", "Inventory Control"], roleSets.commerce, ["sales", "stock", "purchasing"], ["point-of-sale", "replenishment"]),
  "commerce-wholesale": pack("commerce-wholesale", ["Sales", "Warehouse", "Dispatch/Delivery", "Purchasing", "Credit Control & Finance", "Administration"], ["Sales", "Warehouse", "Dispatch"], roleSets.commerce, ["sales", "warehouse", "dispatch", "credit"], ["order-to-delivery", "credit-control"]),
  "commerce-mixed": pack("commerce-mixed", ["Sales & Retail", "Wholesale", "Services", "Warehouse", "Customer Service", "Purchasing", "Finance", "Administration"], ["Sales Floor", "POS", "Warehouse", "Services"], roleSets.commerce, ["sales", "warehouse", "services", "stock"], ["retail-sales", "wholesale-delivery", "service-fulfilment"]),
  "general": pack("general", ["Operations", "Administration", "Finance", "Human Resources", "Stores", "Customer Service"], ["Operations", "Administration", "Stores"], roleSets.general, ["operations", "administration", "stock"], ["work-request", "approval"]),
  "school-nursery": pack("school-nursery", [...schoolDepartments.nursery], ["Early Years", "Care", "Administration"], roleSets.education, ["learning", "care", "administration"], ["admissions", "attendance", "learning"]),
  "school-primary": pack("school-primary", [...schoolDepartments.primary], ["Teaching", "Student Services", "Library"], roleSets.education, ["learning", "student-services", "administration"], ["admissions", "attendance", "assessment"]),
  "school-secondary": pack("school-secondary", [...schoolDepartments.secondary], ["Academic Affairs", "Sciences", "Humanities"], roleSets.education, ["learning", "student-services", "administration"], ["admissions", "attendance", "assessment"]),
  "school-mixed": pack("school-mixed", [...schoolDepartments.mixed], ["Early Years", "Primary", "Secondary"], roleSets.education, ["learning", "student-services", "administration"], ["admissions", "attendance", "assessment"]),
  "school-college": pack("school-college", [...schoolDepartments.college], ["Academic Affairs", "Admissions", "Library"], roleSets.education, ["learning", "admissions", "administration"], ["admissions", "attendance", "assessment"]),
  "school-university": pack("school-university", [...schoolDepartments.university], ["Faculties", "Registry", "Research", "Library"], roleSets.education, ["learning", "research", "administration"], ["admissions", "attendance", "assessment"]),
});

export const MODULE_REGISTRY: Readonly<Record<string, ModuleDefinition>> = Object.freeze({
  dashboard: { id: "dashboard", label: "Dashboard", category: "core", dependencies: [], conflicts: [], entitlementKey: "dashboard" },
  departments: { id: "departments", label: "Departments", category: "core", dependencies: [], conflicts: [], entitlementKey: "departments" },
  employees: { id: "employees", label: "Employees", category: "core", dependencies: [], conflicts: [], entitlementKey: "employees" },
  tasks: { id: "tasks", label: "Tasks", category: "core", dependencies: [], conflicts: [], entitlementKey: "tasks" },
  planner: { id: "planner", label: "Planner", category: "core", dependencies: ["tasks"], conflicts: [], entitlementKey: "planner" },
  messages: { id: "messages", label: "Messages", category: "core", dependencies: [], conflicts: [], entitlementKey: "messages" },
  notifications: { id: "notifications", label: "Notifications", category: "core", dependencies: [], conflicts: [], entitlementKey: "notifications" },
  documents: { id: "documents", label: "Documents", category: "core", dependencies: [], conflicts: [], entitlementKey: "documents" },
  reports: { id: "reports", label: "Reports", category: "core", dependencies: [], conflicts: [], entitlementKey: "reports" },
  approvals: { id: "approvals", label: "Approvals", category: "core", dependencies: ["tasks"], conflicts: [], entitlementKey: "approvals" },
  settings: { id: "settings", label: "Settings", category: "core", dependencies: [], conflicts: [], entitlementKey: "settings" },
  setup: { id: "setup", label: "Setup", category: "core", dependencies: [], conflicts: [], entitlementKey: "setup" },
  compliance: { id: "compliance", label: "Compliance", category: "optional", dependencies: ["documents"], conflicts: [], entitlementKey: "compliance" },
  analytics: { id: "analytics", label: "Analytics", category: "optional", dependencies: ["reports"], conflicts: [], entitlementKey: "analytics" },
  "operational-intelligence": { id: "operational-intelligence", label: "Operational intelligence", category: "optional", dependencies: ["analytics"], conflicts: [], entitlementKey: "operational-intelligence" },
  network: { id: "network", label: "Institutional network", category: "optional", dependencies: [], conflicts: [], entitlementKey: "network" },
  subscription: { id: "subscription", label: "Subscription", category: "optional", dependencies: [], conflicts: [], entitlementKey: "subscription" },
  finance: { id: "finance", label: "Finance", category: "optional", dependencies: ["payments"], conflicts: [], entitlementKey: "finance" },
  resources: { id: "resources", label: "Resources", category: "optional", dependencies: ["inventory"], conflicts: [], entitlementKey: "resources" },
  school: { id: "school", label: "Education", category: "vertical", dependencies: ["documents", "tasks"], conflicts: [], entitlementKey: "school" },
  healthcare: { id: "healthcare", label: "Health", category: "vertical", dependencies: ["documents", "tasks"], conflicts: [], entitlementKey: "healthcare" },
  hospitality: { id: "hospitality", label: "Hospitality & Commerce", category: "vertical", dependencies: ["tasks"], conflicts: [], entitlementKey: "hospitality" },
  inventory: { id: "inventory", label: "Inventory", category: "core", dependencies: ["tasks"], conflicts: [], entitlementKey: "inventory" },
  pharmacy: { id: "pharmacy", label: "Pharmacy", category: "vertical", dependencies: ["healthcare", "prescriptions", "billing"], conflicts: [], entitlementKey: "healthcare" },
  orders: { id: "orders", label: "Orders", category: "optional", dependencies: ["inventory", "payments"], conflicts: [], entitlementKey: "orders" },
  payments: { id: "payments", label: "Payments", category: "optional", dependencies: [], conflicts: [], entitlementKey: "payments" },
  prescriptions: { id: "prescriptions", label: "Prescriptions", category: "optional", dependencies: ["healthcare", "inventory", "payments"], conflicts: [], entitlementKey: "prescriptions" },
  kitchen: { id: "kitchen", label: "Kitchen", category: "optional", dependencies: ["hospitality", "inventory"], conflicts: [], entitlementKey: "kitchen" },
  billing: { id: "billing", label: "Billing", category: "optional", dependencies: ["payments"], conflicts: [], entitlementKey: "billing" },
  customers: { id: "customers", label: "Customers", category: "optional", dependencies: [], conflicts: [], entitlementKey: "customers" },
  invoicing: { id: "invoicing", label: "Invoicing", category: "optional", dependencies: ["customers", "payments"], conflicts: [], entitlementKey: "invoicing" },
  "room-service": { id: "room-service", label: "Hotel Room Service", category: "optional", dependencies: ["orders", "kitchen", "billing"], conflicts: [], entitlementKey: "room-service" },
  "school-cafeteria": { id: "school-cafeteria", label: "School Cafeteria", category: "optional", dependencies: ["orders", "inventory", "payments"], conflicts: [], entitlementKey: "school-cafeteria" },
  "hospital-laboratory": { id: "hospital-laboratory", label: "Hospital Laboratory", category: "optional", dependencies: ["orders", "documents"], conflicts: [], entitlementKey: "hospital-laboratory" },
  wholesale: { id: "wholesale", label: "Wholesale", category: "optional", dependencies: ["customers", "invoicing", "inventory"], conflicts: [], entitlementKey: "wholesale" },
});

export const CORE_MODULE_IDS: readonly string[] = Object.freeze(
  Object.values(MODULE_REGISTRY).filter((module) => module.category === "core").map((module) => module.id),
);

export function resolveModuleDependencies(requested: string[]): string[] {
  const resolved = new Set<string>(CORE_MODULE_IDS);
  const visit = (id: string, visiting: Set<string>) => {
    const definition = MODULE_REGISTRY[id];
    if (!definition) throw new Error(`Unknown module: ${id}`);
    if (visiting.has(id)) throw new Error(`Module dependency cycle at ${id}`);
    if (resolved.has(id)) return;
    visiting.add(id);
    for (const dependency of definition.dependencies) visit(dependency, visiting);
    visiting.delete(id);
    resolved.add(id);
  };
  for (const id of requested) visit(id, new Set());
  for (const id of resolved) {
    for (const conflict of MODULE_REGISTRY[id].conflicts) {
      if (resolved.has(conflict)) throw new Error(`Conflicting modules: ${id} and ${conflict}`);
    }
  }
  return [...resolved];
}

export function previewModuleActivation(requested: string[]) {
  const modules = resolveModuleDependencies(requested);
  return {
    modules,
    enabledDependencies: modules.filter((id) => !CORE_MODULE_IDS.includes(id) && !requested.includes(id)),
    permissions: modules.flatMap((id) => Object.values(SYSTEM_ROLE_TEMPLATES)
      .filter((template) => (template.modules as readonly string[]).includes(id))
      .flatMap((template) => [...template.permissions])),
  };
}

export function getInstitutionType(code: string): InstitutionTypeDefinition | undefined {
  return INSTITUTION_TYPES.find((type) => type.code === code);
}

export function getConfigurationPack(type: InstitutionTypeDefinition): ConfigurationPack {
  const result = CONFIGURATION_PACKS[type.packId];
  if (!result) throw new Error(`Configuration pack is not registered: ${type.packId}`);
  return result;
}
