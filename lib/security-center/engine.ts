export const SECURITY_INCIDENT_STATUSES = [
  "draft",
  "OPEN",
  "TRIAGED",
  "CONTAINING",
  "RESOLVED",
  "CLOSED",
] as const;

export type SecurityIncidentStatus = typeof SECURITY_INCIDENT_STATUSES[number];
export type SecurityIncidentSeverity = "low" | "moderate" | "high" | "critical";

const allowedTransitions: Record<SecurityIncidentStatus, SecurityIncidentStatus[]> = {
  draft: ["OPEN"],
  OPEN: ["TRIAGED"],
  TRIAGED: [],
  CONTAINING: ["RESOLVED"],
  RESOLVED: ["CLOSED", "TRIAGED"],
  CLOSED: ["TRIAGED"],
};

export function transitionSecurityIncident(
  current: SecurityIncidentStatus,
  next: SecurityIncidentStatus,
  reason: string,
): SecurityIncidentStatus {
  if (!allowedTransitions[current]?.includes(next)) {
    throw new Error(`Invalid incident transition: ${current} -> ${next}.`);
  }
  if ((current === "RESOLVED" || current === "CLOSED") && next === "TRIAGED" && reason.trim().length < 8) {
    throw new Error("Reopening an incident requires a reason of at least 8 characters.");
  }
  return next;
}

export type SecurityCheckStatus = "Healthy" | "Needs Attention" | "At Risk" | "Not Enough Data";

export type SecurityPostureCheck = {
  checkId: string;
  title: string;
  source: string;
  evaluation: string;
  status: SecurityCheckStatus;
  freshnessRequirement: string;
  permission: string;
  remediation: string;
  evidence: string;
};

export function buildSecurityPostureChecks(input: {
  sampleSize: number;
  mfaUnenrolled: number | null;
  elevatedGrantCount: number | null;
  inactiveAccountCount: number | null;
  activeSessionCount: number | null;
  activeTerminalCount: number | null;
  activeSupportGrantCount: number | null;
  exportCount: number | null;
  activeBreakGlassCount: number | null;
  quarantinedFileCount: number | null;
  integrationKeyCount: number | null;
  dangerousRoleGrantCount: number | null;
}): SecurityPostureCheck[] {
  const sample = `Bounded institution-scoped sample: ${input.sampleSize} records at most; not a full-tenant assertion.`;
  const observed = (
    count: number | null,
    label: string,
    threshold: string,
    reviewPositive = false,
    statusWhenPositive: SecurityCheckStatus = "Not Enough Data",
  ) => {
    if (count === null) return { status: "Not Enough Data" as const, evidence: "Source unavailable; no healthy state is inferred." };
    if (count === 0) return { status: "Not Enough Data" as const, evidence: `${label}: none observed in the bounded sample. ${sample}` };
    return {
      status: reviewPositive ? statusWhenPositive : "Not Enough Data" as const,
      evidence: `${label}: ${count} observed. ${threshold} ${sample}`,
    };
  };
  const mfa = observed(input.mfaUnenrolled, "Accounts without enrolled MFA", "Coverage policy threshold is not configured.", true, "Needs Attention");
  const elevated = observed(input.elevatedGrantCount, "Elevated grants", "No institution-approved elevated-access baseline is configured.", true, "Needs Attention");
  const inactive = observed(input.inactiveAccountCount, "Inactive accounts", "Staleness threshold is not configured.");
  const sessions = observed(input.activeSessionCount, "Active sessions", "Unusual-session threshold is not configured.");
  const terminals = observed(input.activeTerminalCount, "Active terminal links", "Maximum age and count policies are not configured.");
  const support = observed(input.activeSupportGrantCount, "Active delegated support grants", "Review authorization and expiry; expected concurrency is undefined.", true, "Needs Attention");
  const exports = observed(input.exportCount, "Recent export records", "Review window and alert threshold are not configured.");
  const breakGlass = observed(input.activeBreakGlassCount, "Active break-glass grants", "Review each current grant; no incident-specific approval baseline is configured.", true, "Needs Attention");
  const quarantined = observed(input.quarantinedFileCount, "Files not verified clean", "Scanner integration is not configured; quarantine remains fail-closed.", true, "At Risk");
  const keys = observed(input.integrationKeyCount, "Integration credentials", "Credential last-use telemetry and rotation policy are unavailable.");
  const roles = observed(input.dangerousRoleGrantCount, "Dangerous custom-role grants", "No approved role baseline is configured.", true, "Needs Attention");

  return [
    { checkId: "privileged-mfa", title: "Privileged-user MFA coverage", source: "Firebase Authentication multi-factor enrollment for a bounded users sample", evaluation: "Enrollment is counted; no coverage threshold is configured.", ...mfa, freshnessRequirement: "Refresh on each Security Center load; source sample is not a full census.", permission: "security.center.read", remediation: "Define a coverage threshold and enroll privileged users.", evidence: mfa.evidence },
    { checkId: "elevated-permissions", title: "Elevated permissions", source: "effectivePermissions and memberships", evaluation: "Dangerous grants are counted in a bounded sample; no policy baseline exists.", ...elevated, freshnessRequirement: "Refresh on each Security Center load.", permission: "security.center.read", remediation: "Review role assignments and permission scopes.", evidence: elevated.evidence },
    { checkId: "stale-accounts", title: "Stale or inactive accounts", source: "Institution user profiles", evaluation: "Inactive profiles are counted; a stale-account threshold is not configured.", ...inactive, freshnessRequirement: "Refresh on each Security Center load.", permission: "security.center.read", remediation: "Define inactivity policy, then review and deactivate stale memberships.", evidence: inactive.evidence },
    { checkId: "active-sessions", title: "Active sessions and unusual session counts", source: "securitySessions", evaluation: "Active sessions are counted; no unusual-count threshold is configured.", ...sessions, freshnessRequirement: "Refresh on each Security Center load.", permission: "security.center.read", remediation: "Define session-count policy and revoke only after authorized review.", evidence: sessions.evidence },
    { checkId: "terminal-links", title: "Active terminal links and ages", source: "terminalSessions", evaluation: "Active links are counted; age limits are not configured.", ...terminals, freshnessRequirement: "Refresh on each Security Center load.", permission: "security.center.read", remediation: "Define terminal-link age limits and revoke expired links.", evidence: terminals.evidence },
    { checkId: "delegated-support", title: "Active delegated support access", source: "platformSupportGrants", evaluation: "Unexpired active grants are counted; expected concurrency is undefined.", ...support, freshnessRequirement: "Refresh on each Security Center load.", permission: "security.center.read", remediation: "Review grant scope, reason, institution, operator and expiry.", evidence: support.evidence },
    { checkId: "failed-signins", title: "Failed sign-in trends", source: "No institution-scoped failed-sign-in event collector exists.", evaluation: "Unavailable; successful login events are not used to infer failed attempts.", status: "Not Enough Data", freshnessRequirement: "Requires an operational failed-sign-in collector.", permission: "security.center.read", remediation: "Deploy a privacy-reviewed, institution-scoped failed-sign-in collector.", evidence: "No verified failed-sign-in source is configured." },
    { checkId: "exports", title: "Export activity", source: "analyticsExportAudit", evaluation: "Export records are sampled; review window and alert threshold are undefined.", ...exports, freshnessRequirement: "Refresh on each Security Center load.", permission: "security.center.read", remediation: "Define review windows and export thresholds.", evidence: exports.evidence },
    { checkId: "break-glass", title: "Break-glass usage", source: "breakGlassAccess", evaluation: "Active grants are counted; expired and historical use are not fully summarized.", ...breakGlass, freshnessRequirement: "Refresh on each Security Center load.", permission: "security.center.read", remediation: "Review reason, scope, duration and follow-up evidence.", evidence: breakGlass.evidence },
    { checkId: "quarantined-files", title: "Quarantined files", source: "documents metadata and scanner state", evaluation: "Unverified files are counted; no file is treated as clean without a scanner verdict.", ...quarantined, freshnessRequirement: "Refresh on each Security Center load.", permission: "security.center.read", remediation: "Keep files quarantined until a deployed scanner produces a verifiable clean verdict.", evidence: quarantined.evidence },
    { checkId: "integration-keys", title: "Integration key age and last use", source: "integrationCredentials and integrations", evaluation: "Credential age is sampled; last-use telemetry and rotation policy are absent.", ...keys, freshnessRequirement: "Refresh on each Security Center load.", permission: "security.center.read", remediation: "Add last-use telemetry and define a rotation policy.", evidence: keys.evidence },
    { checkId: "dangerous-roles", title: "Dangerous or excessive role permissions", source: "Institution custom roles and permission registry", evaluation: "Dangerous custom grants are sampled; there is no approved role baseline.", ...roles, freshnessRequirement: "Refresh on each Security Center load.", permission: "security.center.read", remediation: "Review custom role grants against an institution-approved baseline.", evidence: roles.evidence },
  ];
}
