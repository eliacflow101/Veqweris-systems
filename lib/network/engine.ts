import { deterministicId } from "@/lib/governance";
import type { AssistanceRequest, AssistanceRequestState, CollaborationContract, NetworkProfile, NetworkScope } from "./models";

export const assistanceRequestStates: AssistanceRequestState[] = ["Draft", "Submitted", "Under Review", "Accepted", "Declined", "Clarification Required", "In Progress", "Completed", "Cancelled", "Expired"];
const requestTransitions: Record<AssistanceRequestState, AssistanceRequestState[]> = {
  "Draft": ["Submitted", "Cancelled", "Expired"],
  "Submitted": ["Under Review", "Cancelled", "Expired"],
  "Under Review": ["Accepted", "Declined", "Clarification Required", "Cancelled", "Expired"],
  "Accepted": ["In Progress", "Cancelled", "Expired"],
  "Declined": [],
  "Clarification Required": ["Submitted", "Cancelled", "Expired"],
  "In Progress": ["Completed", "Cancelled", "Expired"],
  "Completed": [],
  "Cancelled": [],
  "Expired": [],
};
const forbiddenProfileKeys = ["employees", "patients", "finances", "tasks", "analytics", "documents", "security"];

export function publicNetworkProfile(profile: NetworkProfile): NetworkProfile {
  const result = {
    institutionId: profile.institutionId,
    institutionName: profile.institutionName.trim(),
    broadLocation: profile.broadLocation.trim(),
    selectedServices: [...profile.selectedServices],
    participation: profile.participation,
    contactEnabled: profile.contactEnabled,
    trustState: profile.trustState,
    updatedAt: profile.updatedAt,
  };
  if (Object.keys(result).some((key) => forbiddenProfileKeys.includes(key))) throw new Error("Network profiles cannot contain operational or personal data.");
  if (!result.institutionId || !result.institutionName || !result.broadLocation) throw new Error("Network profile requires institution name and broad location.");
  return result;
}

export function createAssistanceRequest(input: Omit<AssistanceRequest, "requestId" | "state" | "createdAt" | "updatedAt"> & { now?: string }): AssistanceRequest {
  if (input.requesterInstitutionId === input.requestedInstitutionId) throw new Error("An institution cannot request assistance from itself.");
  if (!input.subject.trim() || !input.description.trim()) throw new Error("Assistance request requires a subject and description.");
  const now = input.now ?? new Date().toISOString();
  return { ...input, subject: input.subject.trim(), description: input.description.trim(), requestId: deterministicId("assist", { from: input.requesterInstitutionId, to: input.requestedInstitutionId, requestedBy: input.requestedBy, now }), state: "Draft", createdAt: now, updatedAt: now };
}

export function transitionAssistanceRequest(request: AssistanceRequest, next: AssistanceRequestState, now = new Date().toISOString()): AssistanceRequest {
  if (request.state === next) return { ...request, updatedAt: now };
  if (!requestTransitions[request.state].includes(next)) throw new Error(`Invalid assistance request transition: ${request.state} -> ${next}`);
  return { ...request, state: next, updatedAt: now, ...(next === "Completed" ? { completedAt: now } : {}) };
}

export function createCollaborationContract(input: {
  institutionAId: string; institutionBId: string; initiatedByInstitutionId: string;
  scopes: NetworkScope[]; records: string[]; users: string[]; startsAt: string; endsAt: string; now?: string;
}): CollaborationContract {
  if (input.institutionAId === input.institutionBId || ![input.institutionAId, input.institutionBId].includes(input.initiatedByInstitutionId)) throw new Error("A contract requires two distinct participating institutions.");
  if (!input.scopes.length || new Date(input.endsAt).getTime() <= new Date(input.startsAt).getTime()) throw new Error("A contract requires scope and a valid duration.");
  const now = input.now ?? new Date().toISOString();
  return { ...input, contractId: deterministicId("contract", { a: input.institutionAId, b: input.institutionBId, startsAt: input.startsAt, endsAt: input.endsAt }), status: "pending_approval", approvedBy: {}, approvedAt: {}, createdAt: now, updatedAt: now };
}

export function approveCollaborationContract(contract: CollaborationContract, institutionId: string, uid: string, now = new Date().toISOString()): CollaborationContract {
  if (![contract.institutionAId, contract.institutionBId].includes(institutionId)) throw new Error("Institution is not a contract participant.");
  if (contract.status !== "pending_approval") throw new Error("Only pending contracts can be approved.");
  const approvedBy = { ...contract.approvedBy, [institutionId]: uid };
  const approvedAt = { ...contract.approvedAt, [institutionId]: now };
  const bothApproved = Boolean(approvedBy[contract.institutionAId] && approvedBy[contract.institutionBId]);
  return { ...contract, approvedBy, approvedAt, status: bothApproved ? "active" : "pending_approval", updatedAt: now };
}

export function revokeCollaborationContract(contract: CollaborationContract, institutionId: string, now = new Date().toISOString()): CollaborationContract {
  if (![contract.institutionAId, contract.institutionBId].includes(institutionId)) throw new Error("Institution is not a contract participant.");
  if (contract.status === "revoked") return contract;
  return { ...contract, status: "revoked", revokedAt: now, revokedBy: institutionId, updatedAt: now };
}

export function contractAllowsAccess(contract: CollaborationContract, institutionId: string, scope: NetworkScope, now = new Date()): boolean {
  return contract.status === "active" && [contract.institutionAId, contract.institutionBId].includes(institutionId)
    && contract.scopes.includes(scope) && new Date(contract.startsAt).getTime() <= now.getTime() && new Date(contract.endsAt).getTime() > now.getTime();
}
