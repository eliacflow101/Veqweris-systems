import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  BriefcaseBusiness,
  Building2,
  ChartNoAxesCombined,
  ClipboardCheck,
  FileText,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  ServerCog,
  ShieldCheck,
  Users,
  Wallet,
  School,
  HeartPulse,
} from "lucide-react";
import type { UserRole } from "@/lib/firebase/models";

export type NavigationRole = UserRole;

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  section: "Workspace" | "Information" | "Control" | "Operations" | "Governance" | "Platform";
  requiredPermission?: string;
  requiredModule?: string;
  allowedRoles?: NavigationRole[];
  dataScope?: "institution" | "department" | "self" | "all";
  visibility?: "visible" | "future" | "disabled";
  futureAvailability?: boolean;
  disabled?: boolean;
};

export type NavigationGroup = { label: string; items: NavigationItem[] };

export const navigationConfig: NavigationItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, section: "Workspace", requiredModule: "dashboard", dataScope: "institution", allowedRoles: ["Owner", "Admin", "Manager", "Employee"], visibility: "visible" },
  { label: "Departments", href: "/departments", icon: Building2, section: "Workspace", requiredModule: "departments", dataScope: "institution", allowedRoles: ["Owner", "Admin", "Manager", "Employee"], visibility: "visible" },
  { label: "Employees", href: "/employees", icon: Users, section: "Workspace", requiredModule: "employees", dataScope: "institution", allowedRoles: ["Owner", "Admin", "Manager", "Employee"], visibility: "visible" },
  { label: "Tasks", href: "/tasks", icon: ListTodo, section: "Workspace", requiredModule: "tasks", dataScope: "institution", allowedRoles: ["Owner", "Admin", "Manager", "Employee"], visibility: "visible" },
  { label: "Planner", href: "/planner", icon: FolderKanban, section: "Workspace", requiredModule: "planner", dataScope: "institution", allowedRoles: ["Owner", "Admin", "Manager", "Employee"], visibility: "visible" },
  { label: "Messages", href: "/messages", icon: MessageSquare, section: "Workspace", requiredModule: "messages", dataScope: "institution", allowedRoles: ["Owner", "Admin", "Manager", "Employee"], visibility: "visible" },
  { label: "Documents", href: "/documents", icon: FileText, section: "Information", requiredModule: "documents", visibility: "visible", futureAvailability: false, allowedRoles: ["Owner","Admin","Manager","Employee"], dataScope: "institution" },
  { label: "Documents review", href: "/documents/review", icon: FileText, section: "Information", requiredModule: "documents", visibility: "visible", allowedRoles: ["Owner", "Admin", "Manager"], dataScope: "institution" },
  { label: "Reports", href: "/reports", icon: ChartNoAxesCombined, section: "Information", requiredModule: "reports", visibility: "future", futureAvailability: true },
  { label: "Approvals", href: "/approvals", icon: ClipboardCheck, section: "Control", requiredModule: "approvals", visibility: "visible", futureAvailability: false, allowedRoles: ["Owner", "Admin", "Manager", "Employee"], dataScope: "institution" },
  { label: "Settings", href: "/settings", icon: ServerCog, section: "Control", requiredModule: "settings", visibility: "visible" },
  { label: "Inventory", href: "/inventory", icon: Boxes, section: "Operations", requiredModule: "inventory", visibility: "visible", futureAvailability: false, allowedRoles: ["Owner", "Admin", "Manager", "Employee"], dataScope: "institution" },
  { label: "School", href: "/school", icon: School, section: "Operations", requiredModule: "school", visibility: "visible", futureAvailability: false, allowedRoles: ["Owner", "Admin", "Manager", "Employee"], dataScope: "institution" },
  { label: "Healthcare", href: "/healthcare", icon: HeartPulse, section: "Operations", requiredModule: "healthcare", visibility: "visible", futureAvailability: false, allowedRoles: ["Owner", "Admin", "Manager", "Employee", "Clinician", "Nurse", "Reception", "Billing", "Laboratory", "Pharmacist"], dataScope: "institution" },
  { label: "Students & enrollment", href: "/school/students", icon: School, section: "Operations", requiredModule: "school", visibility: "visible", futureAvailability: false, allowedRoles: ["Owner", "Admin", "Manager"], dataScope: "institution" },
  { label: "School operations", href: "/school/operations", icon: School, section: "Operations", requiredModule: "school", visibility: "visible", futureAvailability: false, allowedRoles: ["Owner", "Admin", "Manager", "Employee"], dataScope: "institution" },
  { label: "School academics", href: "/school/academics", icon: School, section: "Operations", requiredModule: "school", visibility: "visible", futureAvailability: false, allowedRoles: ["Owner", "Admin", "Manager", "Employee"], dataScope: "institution" },
  { label: "Finance", href: "/finance", icon: Wallet, section: "Operations", requiredModule: "finance", visibility: "future", futureAvailability: true },
  { label: "Resources", href: "/resources", icon: BriefcaseBusiness, section: "Governance", requiredModule: "resources", visibility: "future", futureAvailability: true },
  { label: "Compliance", href: "/compliance", icon: ShieldCheck, section: "Governance", requiredModule: "compliance", visibility: "future", futureAvailability: true },
  { label: "Analytics", href: "/analytics", icon: BarChart3, section: "Platform", requiredModule: "analytics", visibility: "future", futureAvailability: true },
  { label: "Platform Administration", href: "/platform-admin", icon: Gauge, section: "Platform", requiredModule: "platform-admin", visibility: "future", futureAvailability: true },
];

export const navigationSections = ["Workspace", "Information", "Control", "Operations", "Governance", "Platform"] as const;

export const navigationGroups: NavigationGroup[] = navigationSections.map((section) => ({
  label: section,
  items: navigationConfig.filter((item) => item.section === section).map((item) => ({
    ...item,
    disabled: item.visibility === "future" || item.visibility === "disabled",
  })),
}));

export function getPageMeta(pathname: string) {
  const matched = navigationConfig.find((item) => item.href === pathname) ?? navigationConfig.find((item) => pathname.startsWith(`${item.href}/`));
  const title = matched?.label ?? "Workspace";
  const subtitle = matched ? "Operations context" : "System context";
  return { title, subtitle, matched };
}

export function isNavItemVisible(item: NavigationItem, role?: string) {
  if (item.visibility === "disabled") return false;
  if (item.visibility === "future") return false;
  if (item.allowedRoles && role && !item.allowedRoles.includes(role as NavigationRole)) return false;
  return true;
}

export const globalSearchPlaceholder = "Search workspace";
export const systemStatus = "All systems nominal";
export const terminalDisabledFeatureNames = ["AI Agent"];
export const isFeatureDisabled = (label: string) => terminalDisabledFeatureNames.includes(label);

export const futureNav = navigationConfig.filter((item) => item.visibility === "future");
export const activeNav = navigationConfig.filter((item) => item.visibility === "visible");
