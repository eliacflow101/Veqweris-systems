import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { createAuditEvent } from "@/lib/governance";
import { approveCollaborationContract, contractAllowsAccess, createAssistanceRequest, createCollaborationContract, publicNetworkProfile, revokeCollaborationContract, transitionAssistanceRequest, type AssistanceRequest, type CollaborationContract, type NetworkProfile } from "@/lib/network";

async function authenticate(request: Request) {
  if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
  const token = await getSessionToken(request);
  if (!token) throw new Error("UNAUTHENTICATED");
  const decoded = await verifyActiveSession(token);
  const snapshot = await adminDb.collection("users").doc(decoded.uid).get();
  const profile = snapshot.data();
  if (!profile?.institutionId || profile.status === "inactive") throw new Error("FORBIDDEN");
  return { decoded, profile };
}

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const status = code === "SERVICE_UNAVAILABLE" ? 503 : code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : 400;
  return NextResponse.json({ error: status === 401 ? "Authentication required." : status === 403 ? "Institution network access required." : "Unable to process network request." }, { status });
}

const adminRoles = ["Owner", "Admin"];
async function audit(institutionId: string, uid: string, action: string, resourceType: string, resourceId: string, payload: Record<string, unknown>) {
  const event = createAuditEvent({ eventId: `${resourceType}_${resourceId}_${Date.now()}`, institutionId, actorUid: uid, action, resourceType, resourceId, payload, occurredAt: new Date().toISOString(), previousHash: null, sequence: 0 });
  await adminDb!.collection("auditEvents").doc(event.eventId).set({ ...event, createdAt: FieldValue.serverTimestamp() });
}

export async function GET(request: Request) {
  try {
    const { profile } = await authenticate(request);
    const params = new URL(request.url).searchParams;
    const profiles = await adminDb!.collection("networkProfiles").get();
    const contracts = await adminDb!.collection("collaborationContracts")
      .where("institutionAId", "==", profile.institutionId).get();
    const contractsB = await adminDb!.collection("collaborationContracts")
      .where("institutionBId", "==", profile.institutionId).get();
    const own = await adminDb!.collection("networkProfiles").doc(profile.institutionId).get();
    const response: Record<string, unknown> = {
      profile: own.exists ? publicNetworkProfile(own.data() as NetworkProfile) : null,
      profiles: profiles.docs.map((doc) => publicNetworkProfile(doc.data() as NetworkProfile)).filter((item) => item.institutionId !== profile.institutionId && !["Restricted", "Suspended", "Revoked"].includes(item.trustState)),
      contracts: [...contracts.docs, ...contractsB.docs].map((doc) => doc.data()),
    };
    if (params.get("requestId")) {
      const requestDoc = await adminDb!.collection("assistanceRequests").doc(params.get("requestId")!).get();
      response.assistanceRequest = requestDoc.exists ? requestDoc.data() : null;
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
      const safe = publicNetworkProfile(body.networkProfile);
      await adminDb!.collection("networkProfiles").doc(profile.institutionId).set(safe, { merge: true });
      await audit(profile.institutionId, decoded.uid, "network_profile.updated", "networkProfile", profile.institutionId, {});
      return NextResponse.json({ profile: safe });
    }
    if (body.action === "request_assistance" && body.request) {
      const assistance = createAssistanceRequest({ ...(body.request as Omit<AssistanceRequest, "requestId" | "state" | "createdAt" | "updatedAt">), requesterInstitutionId: profile.institutionId, requestedBy: decoded.uid });
      const submitted = transitionAssistanceRequest(assistance, "Submitted");
      await adminDb!.collection("assistanceRequests").doc(submitted.requestId).set(submitted);
      await audit(profile.institutionId, decoded.uid, "assistance.requested", "assistanceRequest", assistance.requestId, { requestedInstitutionId: assistance.requestedInstitutionId });
      return NextResponse.json({ assistance: submitted }, { status: 201 });
    }
    if (body.action === "transition_assistance" && body.requestId && body.nextState) {
      const ref = adminDb!.collection("assistanceRequests").doc(body.requestId);
      const snapshot = await ref.get(); const current = snapshot.data() as AssistanceRequest;
      if (!snapshot.exists || ![current.requesterInstitutionId, current.requestedInstitutionId].includes(profile.institutionId)) throw new Error("Assistance request is outside institution scope.");
      const assistance = transitionAssistanceRequest(current, body.nextState);
      await ref.set(assistance);
      await audit(profile.institutionId, decoded.uid, "assistance.transitioned", "assistanceRequest", assistance.requestId, { state: assistance.state });
      return NextResponse.json({ assistance });
    }
    if (body.action === "create_contract" && body.contract) {
      const contract = createCollaborationContract({ ...(body.contract as Omit<CollaborationContract, "contractId" | "status" | "approvedBy" | "approvedAt" | "createdAt" | "updatedAt">), initiatedByInstitutionId: profile.institutionId });
      await adminDb!.collection("collaborationContracts").doc(contract.contractId).set(contract);
      await audit(profile.institutionId, decoded.uid, "contract.created", "collaborationContract", contract.contractId, { counterparty: contract.institutionBId === profile.institutionId ? contract.institutionAId : contract.institutionBId });
      return NextResponse.json({ contract }, { status: 201 });
    }
    if ((body.action === "approve_contract" || body.action === "revoke_contract") && body.contractId) {
      const ref = adminDb!.collection("collaborationContracts").doc(body.contractId); const snapshot = await ref.get();
      if (!snapshot.exists) throw new Error("Contract not found.");
      const current = snapshot.data() as CollaborationContract;
      const contract = body.action === "approve_contract" ? approveCollaborationContract(current, profile.institutionId, decoded.uid) : revokeCollaborationContract(current, profile.institutionId);
      await ref.set(contract);
      await audit(profile.institutionId, decoded.uid, body.action === "approve_contract" ? "contract.approved" : "contract.revoked", "collaborationContract", contract.contractId, { status: contract.status });
      return NextResponse.json({ contract });
    }
    if (body.action === "create_workspace_record" && body.contractId && body.record) {
      const snapshot = await adminDb!.collection("collaborationContracts").doc(body.contractId).get(); const contract = snapshot.data() as CollaborationContract;
      const scope = body.record.scope as Parameters<typeof contractAllowsAccess>[2];
      if (!snapshot.exists || !contractAllowsAccess(contract, profile.institutionId, scope)) throw new Error("Active contract scope is required.");
      if (typeof body.record.recordId !== "string" || !body.record.recordId) throw new Error("Workspace record requires an id.");
      const record = { ...body.record, contractId: body.contractId, ownerInstitutionId: profile.institutionId, createdBy: decoded.uid, createdAt: new Date().toISOString() } as unknown as Record<string, unknown> & { recordId: string };
      await adminDb!.collection("networkWorkspaceRecords").doc(String(record.recordId)).set(record);
      await audit(profile.institutionId, decoded.uid, "workspace_record.created", "networkWorkspaceRecord", String(record.recordId), { contractId: body.contractId, scope });
      return NextResponse.json({ record }, { status: 201 });
    }
    return NextResponse.json({ error: "Unsupported network action." }, { status: 400 });
  } catch (error) { return failure(error); }
}
