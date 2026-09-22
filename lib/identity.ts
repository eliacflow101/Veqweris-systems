import type { LockTimeout, SessionPolicy } from "@/lib/firebase/models";

export const SESSION_POLICY_OPTIONS: Array<{ value: SessionPolicy; label: string }> = [
  { value: "browser_close", label: "Browser close" },
  { value: "1_day", label: "1 day" },
  { value: "7_days", label: "7 days (default)" },
  { value: "30_days", label: "30 days" },
];

export const LOCK_TIMEOUT_OPTIONS: Array<{ value: LockTimeout; label: string }> = [
  { value: "never", label: "Never" },
  { value: "5_minutes", label: "5 minutes" },
  { value: "10_minutes", label: "10 minutes" },
  { value: "15_minutes", label: "15 minutes" },
  { value: "30_minutes", label: "30 minutes" },
  { value: "60_minutes", label: "60 minutes" },
];

export const sessionPolicyMap: Record<SessionPolicy, number> = {
  browser_close: 0,
  "1_day": 60 * 60 * 24,
  "7_days": 60 * 60 * 24 * 7,
  "30_days": 60 * 60 * 24 * 30,
};

export const lockTimeoutMap: Record<LockTimeout, number> = {
  never: 0,
  "5_minutes": 5 * 60 * 1000,
  "10_minutes": 10 * 60 * 1000,
  "15_minutes": 15 * 60 * 1000,
  "30_minutes": 30 * 60 * 1000,
  "60_minutes": 60 * 60 * 1000,
};

export function getSessionMaxAgeSeconds(policy: SessionPolicy | undefined): number {
  return sessionPolicyMap[policy ?? "7_days"];
}

export function getLockTimeoutMs(policy: LockTimeout | undefined): number {
  return lockTimeoutMap[policy ?? "15_minutes"]; 
}

export function canEditProfileField(field: string, role?: string): boolean {
  if (!role) return false;
  const immutable = ["uid", "institutionId", "role", "securityStatus", "status", "recoveryFactors"];
  return !immutable.includes(field);
}

export function safeRecoveryInstitutionCheck(suppliedInstitutionId?: string, authoritativeInstitutionId?: string) {
  if (!suppliedInstitutionId || !authoritativeInstitutionId) return false;
  return suppliedInstitutionId === authoritativeInstitutionId;
}

export function sanitizeProfileInput(input: Record<string, unknown>) {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    next[key] = value;
  }
  return next;
}
