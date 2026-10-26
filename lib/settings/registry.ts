import type { SensitivityClass } from "@/lib/permissions/registry";

export const SETTINGS_CATEGORIES = [
  "Institution Profile & Branding",
  "Organization",
  "Modules & Features",
  "Workflows & Approvals",
  "Documents & Templates",
  "Notifications",
  "Security & Access",
  "Billing & Subscription",
  "Data, Locale & Compliance",
] as const;

export type SettingsCategory = typeof SETTINGS_CATEGORIES[number];
export type SettingsEffect = "immediate" | "next_session" | "requires_approval" | "read_only";
export type SettingsType = "string" | "email" | "url" | "color" | "boolean" | "integer" | "string_list" | "enum";

export interface SettingDefinition {
  key: string;
  sectionId: string;
  label: string;
  type: SettingsType;
  permission: string;
  sensitivity: SensitivityClass;
  effect: SettingsEffect;
  defaultValue?: string | boolean | number | string[];
  options?: readonly string[];
  minimum?: number;
  maximum?: number;
  platformMinimum?: number;
}

export const SETTING_REGISTRY: readonly SettingDefinition[] = [
  { key: "profile.legalName", sectionId: "profile", label: "Registered legal name", type: "string", permission: "organization.roles.manage", sensitivity: "CONFIDENTIAL", effect: "immediate" },
  { key: "profile.tradingName", sectionId: "profile", label: "Trading name", type: "string", permission: "organization.roles.manage", sensitivity: "INTERNAL", effect: "immediate" },
  { key: "profile.registrationNumber", sectionId: "profile", label: "Registration number", type: "string", permission: "organization.roles.manage", sensitivity: "CONFIDENTIAL", effect: "immediate" },
  { key: "profile.taxId", sectionId: "profile", label: "Tax identification number", type: "string", permission: "organization.roles.manage", sensitivity: "RESTRICTED", effect: "immediate" },
  { key: "profile.address", sectionId: "profile", label: "Address", type: "string", permission: "organization.roles.manage", sensitivity: "CONFIDENTIAL", effect: "immediate" },
  { key: "profile.phone", sectionId: "profile", label: "Phone", type: "string", permission: "organization.roles.manage", sensitivity: "CONFIDENTIAL", effect: "immediate" },
  { key: "profile.email", sectionId: "profile", label: "Email", type: "email", permission: "organization.roles.manage", sensitivity: "CONFIDENTIAL", effect: "immediate" },
  { key: "profile.website", sectionId: "profile", label: "Website", type: "url", permission: "organization.roles.manage", sensitivity: "INTERNAL", effect: "immediate" },
  { key: "profile.accentColor", sectionId: "profile", label: "Accent color", type: "color", permission: "organization.roles.manage", sensitivity: "INTERNAL", effect: "immediate", defaultValue: "#2563EB" },
  { key: "profile.documentFooter", sectionId: "profile", label: "Document footer", type: "string", permission: "organization.roles.manage", sensitivity: "INTERNAL", effect: "immediate" },
  { key: "profile.whiteLabelFooter", sectionId: "profile", label: "Remove VEQWERIS footer", type: "boolean", permission: "organization.roles.manage", sensitivity: "CONFIDENTIAL", effect: "immediate", defaultValue: false },
  { key: "notifications.emailEnabled", sectionId: "notifications", label: "Email notifications", type: "boolean", permission: "organization.roles.manage", sensitivity: "INTERNAL", effect: "immediate", defaultValue: true },
  { key: "notifications.taskReminders", sectionId: "notifications", label: "Task reminders", type: "boolean", permission: "organization.roles.manage", sensitivity: "INTERNAL", effect: "immediate", defaultValue: true },
  { key: "security.sessionTimeoutMinutes", sectionId: "security", label: "Session timeout (minutes)", type: "integer", permission: "organization.roles.manage", sensitivity: "RESTRICTED", effect: "next_session", minimum: 5, maximum: 1440, platformMinimum: 5 },
  { key: "security.requireMfaForAdmins", sectionId: "security", label: "Require MFA for administrators", type: "boolean", permission: "organization.roles.manage", sensitivity: "RESTRICTED", effect: "next_session", defaultValue: true },
  { key: "security.allowedInviteDomains", sectionId: "security", label: "Allowed invitation email domains", type: "string_list", permission: "organization.roles.manage", sensitivity: "RESTRICTED", effect: "immediate" },
  { key: "security.terminalMaxLifetimeMinutes", sectionId: "security", label: "Maximum terminal link lifetime (minutes)", type: "integer", permission: "organization.roles.manage", sensitivity: "RESTRICTED", effect: "immediate", minimum: 5, maximum: 1440, platformMinimum: 5 },
  { key: "locale.timezone", sectionId: "locale", label: "Timezone", type: "string", permission: "organization.roles.manage", sensitivity: "INTERNAL", effect: "requires_approval" },
  { key: "locale.currency", sectionId: "locale", label: "Primary currency", type: "string", permission: "organization.roles.manage", sensitivity: "CONFIDENTIAL", effect: "requires_approval" },
  { key: "locale.language", sectionId: "locale", label: "Language", type: "string", permission: "organization.roles.manage", sensitivity: "INTERNAL", effect: "immediate", defaultValue: "en" },
  { key: "locale.dateFormat", sectionId: "locale", label: "Date format", type: "enum", permission: "organization.roles.manage", sensitivity: "INTERNAL", effect: "immediate", options: ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"] },
  { key: "locale.timeFormat", sectionId: "locale", label: "Time format", type: "enum", permission: "organization.roles.manage", sensitivity: "INTERNAL", effect: "immediate", options: ["12h", "24h"] },
  { key: "locale.fiscalYearStartMonth", sectionId: "locale", label: "Fiscal year start month", type: "integer", permission: "organization.roles.manage", sensitivity: "CONFIDENTIAL", effect: "requires_approval", minimum: 1, maximum: 12 },
  { key: "locale.weekStart", sectionId: "locale", label: "Week starts on", type: "enum", permission: "organization.roles.manage", sensitivity: "INTERNAL", effect: "immediate", options: ["Monday", "Sunday", "Saturday"] },
] as const;

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return SETTING_REGISTRY.find((setting) => setting.key === key);
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.trim() }).format();
    return value.trim().length > 0;
  } catch {
    return false;
  }
}

function linearize(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.slice(1);
  const channels = [0, 2, 4].map((index) => linearize(Number.parseInt(value.slice(index, index + 2), 16)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(left: number, right: number): number {
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

export function hasAccessibleAccentContrast(value: string): boolean {
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) return false;
  const accent = luminance(value);
  const lightThemeText = Math.max(contrastRatio(accent, luminance("#111827")), contrastRatio(accent, luminance("#FFFFFF")));
  const darkThemeText = Math.max(contrastRatio(accent, luminance("#111827")), contrastRatio(accent, luminance("#FFFFFF")));
  return lightThemeText >= 4.5 && darkThemeText >= 4.5;
}

export function validateSettingsSection(sectionId: string, values: unknown): Record<string, string | boolean | number | string[]> {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Settings values must be an object.");
  const input = values as Record<string, unknown>;
  const definitions = SETTING_REGISTRY.filter((setting) => setting.sectionId === sectionId);
  if (!definitions.length) throw new Error("Unknown settings section.");
  const output: Record<string, string | boolean | number | string[]> = {};
  for (const [key, value] of Object.entries(input)) {
    const setting = getSettingDefinition(key);
    if (!setting || setting.sectionId !== sectionId) throw new Error(`Setting ${key} is not editable in this section.`);
    if (setting.type === "string" && typeof value === "string" && value.length <= 500
      && (setting.key !== "profile.legalName" || value.trim().length > 0)
      && (setting.key !== "locale.timezone" || validTimezone(value))
      && (setting.key !== "locale.currency" || /^[A-Za-z]{3}$/.test(value.trim()))) output[key] = value.trim();
    else if (setting.type === "email" && typeof value === "string" && validEmail(value.trim())) output[key] = value.trim().toLowerCase();
    else if (setting.type === "url" && typeof value === "string" && validUrl(value)) output[key] = value.trim();
    else if (setting.type === "color" && typeof value === "string" && hasAccessibleAccentContrast(value)) output[key] = value.toUpperCase();
    else if (setting.type === "boolean" && typeof value === "boolean") output[key] = value;
    else if (setting.type === "integer" && typeof value === "number" && Number.isSafeInteger(value)
      && value >= (setting.minimum ?? Number.MIN_SAFE_INTEGER) && value <= (setting.maximum ?? Number.MAX_SAFE_INTEGER)
      && value >= (setting.platformMinimum ?? Number.MIN_SAFE_INTEGER)) output[key] = value;
    else if (setting.type === "string_list" && Array.isArray(value) && value.length <= 50
      && value.every((item) => typeof item === "string" && item.length <= 253
        && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(item.trim()))) {
      output[key] = [...new Set((value as string[]).map((item) => item.trim().toLowerCase()))];
    } else if (setting.type === "enum" && typeof value === "string" && setting.options?.includes(value)) output[key] = value;
    else throw new Error(`Invalid value for ${setting.label}.`);
  }
  return output;
}
