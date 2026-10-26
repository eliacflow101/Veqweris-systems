import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { institutionHasModuleEntitlement } from "@/lib/platform/tenant-entitlements";
import { createAuditEvent } from "@/lib/governance";
import { approveCollaborationContract, canInstitutionTransitionAssistance, canViewAssistanceRequest, contractAllowsAccess, createAssistanceRequest, createCollaborationContract, publicNetworkProfile, revokeCollaborationContract, transitionAssistanceRequest, type AssistanceRequest, type CollaborationContract, type NetworkProfile } from "@/lib/network";

async function authenticate(request: Request) {
  if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
  const token = await getSessionToken(request);
  if (!token) throw new Error("UNAUTHENTICATED");
  const decoded = await verifyActiveSession(token);
  const snapshot = await adminDb.collection("users").doc(decoded.uid).get();
  const profile = snapshot.data();
  if (!profile?.institutionId || profile.status === "inactive") throw new Error("FORBIDDEN");
  if (!await institutionHasModuleEntitlement(profile.institutionId, "network")) throw new Error("FORBIDDEN");
  return { decoded, profile };
}

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const status = code === "SERVICE_UNAVAILABLE" ? 503 : code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : 400;
  return NextResponse.json({ error: status === 401 ? "Authentication required." : status === 403 ? "Institution network access required." : "Unable to process network request." }, { status });
}

const adminRoles = ["Owner", "Admin"];
async function appendAudit(
  transaction: Transaction,
  institutionId: string,
  uid: string,
  action: string,
  resourceType: string,
  resourceId: string,
  payload: Record<string, unknown>,
  writeAdditional?: (transaction: Transaction) => void,
) {
  const headRef = adminDb!.collection("networkAuditHeads").doc(institutionId);
  const head = await transaction.get(headRef);
  const previousSequence = Number(head.get("sequence"));
  const previousHash = head.get("hash");
  if (head.exists && (!Number.isSafeInteger(previousSequence) || previousSequence < 0
    || typeof previousHash !== "string" || !previousHash)) {
    throw new Error("NETWORK_AUDIT_CHAIN_INVALID");
  }
  const eventRef = adminDb!.collection("auditEvents").doc();
  const occurredAt = new Date().toISOString();
  const event = createAuditEvent({
    eventId: eventRef.id,
    institutionId,
    actorUid: uid,
    action,
    resourceType,
    resourceId,
    payload: { ...payload, auditChain: "network" },
    occurredAt,
    previousHash: head.exists ? previousHash as string : null,
    sequence: head.exists ? previousSequence + 1 : 0,
  });
  writeAdditional?.(transaction);
  transaction.create(eventRef, event);
  transaction.set(headRef, { sequence: event.sequence, hash: event.hash, updatedAt: FieldValue.serverTimestamp() });
}

export async function GET(request: Request) {
  try {
    const { profile } = await authenticate(request);
    const params = new URL(request.url).searchParams;
    const profiles = await adminDb!.collection("networkProfiles").limit(200).get();
    const contracts = await adminDb!.collection("collaborationContracts")
      .where("institutionAId", "==", profile.institutionId).limit(500).get();
    const contractsB = await adminDb!.collection("collaborationContracts")
      .where("institutionBId", "==", profile.institutionId).limit(500).get();
    const own = await adminDb!.collection("networkProfiles").doc(profile.institutionId).get();
    const response: Record<string, unknown> = {
      profile: own.exists ? publicNetworkProfile(own.data() as NetworkProfile) : null,
      profiles: profiles.docs.map((doc) => publicNetworkProfile(doc.data() as NetworkProfile)).filter((item) => item.institutionId !== profile.institutionId && !["Restricted", "Suspended", "Revoked"].includes(item.trustState)),
      contracts: [...contracts.docs, ...contractsB.docs].map((doc) => doc.data()),
    };
    if (params.get("requestId")) {
      const requestDoc = await adminDb!.collection("assistanceRequests").doc(params.get("requestId")!).get();
      const assistance = requestDoc.data() as AssistanceRequest | undefined;
      if (!requestDoc.exists || !assistance || !canViewAssistanceRequest(assistance, profile.institutionId)) {
        return NextResponse.json({ error: "Assistance request not found." }, { status: 404 });
      }
      response.assistanceRequest = assistance;
    }
    return NextResponse.json(response);
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const { decoded, profile } = await authenticate(request);
    const body = await request.json() as { action?: string; networkProfile?: NetworkProfile; request?: Partial<AssistanceRequest>; requestId?: string; nextState?: AssistanceRequest["state"]; contract?: Partial<CollaborationContract>; contractId?: string; record?: Record<string, unknown> };
    if (!adminRoles.includes(profile.role)) return NextResponse.json({ error: "Network governance requires an owner or administrator." }, { status: 403 });
    if (body.action === "upsert_profile" && body.networkProfile) {
      if (body.networkProfile.institutionId !== profile.institutionId) throw new Error("Institution scope cannot be changed.");
      const input = body.networkProfile;
      if (typeof input.institutionName !== "string" || input.institutionName.length > 120
        || typeof input.broadLocation !== "string" || input.broadLocation.length > 120
        || !Array.isArray(input.selectedServices) || input.selectedServices.length > 20
        || input.selectedServices.some((service) => typeof service !== "string" || service.length > 80)
        || !["open", "invite_only", "not_accepting"].includes(input.participation)
        || typeof input.contactEnabled !== "boolean") {
        return NextResponse.json({ error: "Network profile contains invalid or oversized fields." }, { status: 400 });
      }
      const profileRef = adminDb!.collection("networkProfiles").doc(profile.institutionId);
      let safeProfile: NetworkProfile | undefined;
      await adminDb!.runTransaction(async (transaction) => {
        const existing = await transaction.get(profileRef);
        const authoritativeTrust = existing.exists
          ? (existing.get("platformTrustState") as NetworkProfile["trustState"] | undefined) ?? "Registered"
          : "Registered";
        safeProfile = {
          ...publicNetworkProfile({
            ...input,
            institutionId: profile.institutionId,
            trustState: authoritativeTrust,
            platformTrustState: authoritativeTrust,
            updatedAt: new Date().toISOString(),
          }),
          platformTrustState: authoritativeTrust,
        };
        await appendAudit(
          transaction,
          profile.institutionId,
          decoded.uid,
          "network_profile.updated",
          "networkProfile",
          profile.institutionId,
          {},
          (currentTransaction) => currentTransaction.set(profileRef, safeProfile!, { merge: true }),
        );
      });
      return NextResponse.json({ profile: safeProfile });
    }
    if (body.action === "request_assistance" && body.request) {
      const input = body.request;
      if (typeof input.requestedInstitutionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.requestedInstitutionId)
        || typeof input.subject !== "string" || !input.subject.trim() || input.subject.length > 160
        || typeof input.description !== "string" || !input.description.trim() || input.description.length > 5_000
        || !["assistance", "service_directory", "workspace_records"].includes(String(input.requestedScope))) {
        return NextResponse.json({ error: "Assistance request contains invalid or oversized fields." }, { status: 400 });
      }
      const assistance = createAssistanceRequest({
        requestedInstitutionId: input.requestedInstitutionId,
        requestedBy: decoded.uid,
        subject: input.subject,
        description: input.description,
        requestedScope: input.requestedScope as AssistanceRequest["requestedScope"],
        requesterInstitutionId: profile.institutionId,
      });
      const submitted = transitionAssistanceRequest(assistance, "Submitted");
      const requestRef = adminDb!.collection("assistanceRequests").doc(submitted.requestId);
      const targetInstitutionRef = adminDb!.collection("institutions").doc(submitted.requestedInstitutionId);
      const targetProfileRef = adminDb!.collection("networkProfiles").doc(submitted.requestedInstitutionId);
      await adminDb!.runTransaction(async (transaction) => {
        const [targetInstitution, targetProfile, existing] = await transaction.getAll(targetInstitutionRef, targetProfileRef, requestRef);
        const targetProfileData = targetProfile.data() as NetworkProfile | undefined;
        if (!targetInstitution.exists || targetInstitution.get("status") !== "active"
          || !targetProfile.exists || !targetProfileData
          || targetProfileData.participation === "not_accepting"
          || !["open", "invite_only"].includes(targetProfileData.participation)) {
          throw new Error("The requested institution is not accepting network assistance.");
        }
        if (targetProfileData.participation === "invite_only") {
          const membershipQuery = adminDb!.collection("networkMemberships")
            .where("institutionId", "==", submitted.requestedInstitutionId)
            .where("memberInstitutionId", "==", profile.institutionId)
            .where("status", "==", "active")
            .limit(1);
          const membership = await transaction.get(membershipQuery);
          if (membership.empty) throw new Error("An active network invitation is required.");
        }
        if (existing.exists) throw new Error("This assistance request already exists.");
        await appendAudit(
          transaction,
          profile.institutionId,
          decoded.uid,
          "assistance.requested",
          "assistanceRequest",
          submitted.requestId,
          { requestedInstitutionId: submitted.requestedInstitutionId },
          (currentTransaction) => currentTransaction.create(requestRef, submitted),
        );
      });
      return NextResponse.json({ assistance: submitted }, { status: 201 });
    }
    if (body.action === "transition_assistance" && body.requestId && body.nextState) {
      if (!["Draft", "Submitted", "Under Review", "Accepted", "Declined", "Clarification Required", "In Progress", "Completed", "Cancelled", "Expired"].includes(body.nextState)) {
        return NextResponse.json({ error: "A valid assistance state is required." }, { status: 400 });
      }
      const ref = adminDb!.collection("assistanceRequests").doc(body.requestId);
      const assistance = await adminDb!.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const current = snapshot.data() as AssistanceRequest | undefined;
        if (!snapshot.exists || !current || ![current.requesterInstitutionId, current.requestedInstitutionId].includes(profile.institutionId)) {
          throw new Error("Assistance request is outside institution scope.");
        }
        if (!canInstitutionTransitionAssistance(current, body.nextState!, profile.institutionId)) {
          throw new Error("ASSISTANCE_TRANSITION_FORBIDDEN");
        }
        const updated = transitionAssistanceRequest(current, body.nextState!);
        await appendAudit(
          transaction,
          profile.institutionId,
          decoded.uid,
          "assistance.transitioned",
          "assistanceRequest",
          updated.requestId,
          { previousState: current.state, state: updated.state },
          (currentTransaction) => currentTransaction.set(ref, updated),
        );
        return updated;
      });
      return NextResponse.json({ assistance });
    }
    if (body.action === "create_contract" && body.contract) {
      const input = body.contract;
      if (typeof input.institutionAId !== "string" || typeof input.institutionBId !== "string"
        || !Array.isArray(input.scopes) || input.scopes.length > 3
        || input.scopes.some((scope) => !["assistance", "service_directory", "workspace_records"].includes(String(scope)))
        || !Array.isArray(input.records) || input.records.length > 100
        || input.records.some((record) => typeof record !== "string" || record.length > 80)
        || !Array.isArray(input.users) || input.users.length > 100
        || input.users.some((user) => typeof user !== "string" || user.length > 128)
        || typeof input.startsAt !== "string" || !Number.isFinite(Date.parse(input.startsAt))
        || typeof input.endsAt !== "string" || !Number.isFinite(Date.parse(input.endsAt))) {
        return NextResponse.json({ error: "Collaboration contract contains invalid or oversized fields." }, { status: 400 });
      }
      const contract = createCollaborationContract({
        institutionAId: input.institutionAId,
        institutionBId: input.institutionBId,
        initiatedByInstitutionId: profile.institutionId,
        scopes: input.scopes as CollaborationContract["scopes"],
        records: input.records,
        users: input.users,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      });
      const ref = adminDb!.collection("collaborationContracts").doc(contract.contractId);
      const counterpartyId = contract.institutionAId === profile.institutionId ? contract.institutionBId : contract.institutionAId;
      const counterpartyRef = adminDb!.collection("institutions").doc(counterpartyId);
      const counterpartyProfileRef = adminDb!.collection("networkProfiles").doc(counterpartyId);
      await adminDb!.runTransaction(async (transaction) => {
        const [existing, counterparty, counterpartyProfile] = await transaction.getAll(ref, counterpartyRef, counterpartyProfileRef);
        if (existing.exists) throw new Error("A contract with the same participants and duration already exists.");
        if (!counterparty.exists || counterparty.get("status") !== "active" || !counterpartyProfile.exists) {
          throw new Error("The counterparty institution is not available for network collaboration.");
        }
        await appendAudit(
          transaction,
          profile.institutionId,
          decoded.uid,
          "contract.created",
          "collaborationContract",
          contract.contractId,
          { counterparty: counterpartyId },
          (currentTransaction) => currentTransaction.create(ref, contract),
        );
      });
      return NextResponse.json({ contract }, { status: 201 });
    }
    if ((body.action === "approve_contract" || body.action === "revoke_contract") && body.contractId) {
      const ref = adminDb!.collection("collaborationContracts").doc(body.contractId);
      const contract = await adminDb!.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) throw new Error("Contract not found.");
        const current = snapshot.data() as CollaborationContract;
        if (![current.institutionAId, current.institutionBId].includes(profile.institutionId)) {
          throw new Error("Institution is not a contract participant.");
        }
        if (body.action === "revoke_contract" && current.status === "revoked") return current;
        if (body.action === "approve_contract" && current.approvedBy?.[profile.institutionId]) return current;
        const updated = body.action === "approve_contract"
          ? approveCollaborationContract(current, profile.institutionId, decoded.uid)
          : revokeCollaborationContract(current, profile.institutionId);
        await appendAudit(
          transaction,
          profile.institutionId,
          decoded.uid,
          body.action === "approve_contract" ? "contract.approved" : "contract.revoked",
          "collaborationContract",
          updated.contractId,
          { status: updated.status },
          (currentTransaction) => currentTransaction.set(ref, updated),
        );
        return updated;
      });
      return NextResponse.json({ contract });
    }
    if (body.action === "create_workspace_record" && body.contractId && body.record) {
      const { record: input } = body;
      const scope = input.scope;
      const recordId = input.recordId;
      const recordType = input.recordType;
      if (typeof recordId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(recordId)
        || typeof recordType !== "string" || recordType.length > 80
        || typeof input.title !== "string" || !input.title.trim() || input.title.length > 200
        || typeof input.body !== "string" || input.body.length > 10_000
        || !["assistance", "service_directory", "workspace_records"].includes(String(scope))) {
        return NextResponse.json({ error: "Workspace record contains invalid or oversized fields." }, { status: 400 });
      }
      const contractRef = adminDb!.collection("collaborationContracts").doc(body.contractId);
      const recordRef = adminDb!.collection("networkWorkspaceRecords").doc(recordId);
      const record = {
        recordId,
        contractId: body.contractId,
        ownerInstitutionId: profile.institutionId,
        recordType,
        scope,
        title: input.title.trim(),
        body: input.body,
        createdBy: decoded.uid,
        createdAt: new Date().toISOString(),
      };
      await adminDb!.runTransaction(async (transaction) => {
        const [snapshot, existing] = await transaction.getAll(contractRef, recordRef);
        const contract = snapshot.data() as CollaborationContract | undefined;
        if (!snapshot.exists || !contract || !contractAllowsAccess(contract, profile.institutionId, scope as Parameters<typeof contractAllowsAccess>[2])
          || !contract.records.includes(recordType)) throw new Error("Active contract scope is required.");
        if (existing.exists) throw new Error("Workspace record id is already in use.");
        await appendAudit(
          transaction,
          profile.institutionId,
          decoded.uid,
          "workspace_record.created",
          "networkWorkspaceRecord",
          recordId,
          { contractId: body.contractId, scope, recordType },
          (currentTransaction) => currentTransaction.create(recordRef, record),
        );
      });
      return NextResponse.json({ record }, { status: 201 });
    }
    return NextResponse.json({ error: "Unsupported network action." }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && ["ASSISTANCE_TRANSITION_FORBIDDEN", "NETWORK_AUDIT_CHAIN_INVALID"].includes(error.message)) {
      return NextResponse.json({
        error: error.message === "ASSISTANCE_TRANSITION_FORBIDDEN"
          ? "This institution cannot perform the requested assistance transition."
          : "The network audit chain is unavailable; no changes were saved.",
      }, { status: error.message === "ASSISTANCE_TRANSITION_FORBIDDEN" ? 403 : 503 });
    }
    return failure(error);
  }
}
