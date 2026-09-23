import assert from "node:assert/strict";
import { approveCollaborationContract, contractAllowsAccess, createAssistanceRequest, createCollaborationContract, publicNetworkProfile, revokeCollaborationContract, transitionAssistanceRequest } from "../lib/network";

const request = createAssistanceRequest({ requesterInstitutionId: "A", requestedInstitutionId: "B", requestedBy: "a-owner", subject: "Mutual aid", description: "Please coordinate a service.", requestedScope: "assistance", now: "2026-01-01T00:00:00.000Z" });
assert.equal(request.state, "Draft");
const submitted = transitionAssistanceRequest(request, "Submitted");
assert.equal(submitted.state, "Submitted");
const underReview = transitionAssistanceRequest(submitted, "Under Review");
assert.equal(underReview.state, "Under Review");
assert.equal(transitionAssistanceRequest(underReview, "Clarification Required").state, "Clarification Required");
assert.throws(() => transitionAssistanceRequest(request, "Completed"), /Invalid assistance/);
assert.throws(() => transitionAssistanceRequest(underReview, "In Progress"), /Invalid assistance/);

const draft = createCollaborationContract({ institutionAId: "A", institutionBId: "B", initiatedByInstitutionId: "A", scopes: ["workspace_records"], records: ["service-summary"], users: [], startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2026-02-01T00:00:00.000Z", now: "2026-01-01T00:00:00.000Z" });
const oneApproval = approveCollaborationContract(draft, "A", "a-owner");
assert.equal(oneApproval.status, "pending_approval");
const active = approveCollaborationContract(oneApproval, "B", "b-owner");
assert.equal(active.status, "active");
assert.equal(contractAllowsAccess(active, "B", "workspace_records", new Date("2026-01-15T00:00:00.000Z")), true);
assert.equal(contractAllowsAccess(active, "C", "workspace_records", new Date("2026-01-15T00:00:00.000Z")), false);
assert.equal(contractAllowsAccess(active, "B", "assistance", new Date("2026-01-15T00:00:00.000Z")), false);
const revoked = revokeCollaborationContract(active, "A");
assert.equal(contractAllowsAccess(revoked, "B", "workspace_records"), false);

const profile = publicNetworkProfile({ institutionId: "A", institutionName: "A", broadLocation: "North", selectedServices: ["coordination"], participation: "open", contactEnabled: true, trustState: "Verified", updatedAt: "2026-01-01" });
assert.deepEqual(Object.keys(profile).sort(), ["broadLocation", "contactEnabled", "institutionId", "institutionName", "participation", "selectedServices", "trustState", "updatedAt"]);
console.log("network engine tests passed");
