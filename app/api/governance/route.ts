import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { createBreakGlassAccess, transitionFinding, type Finding, type FindingStatus } from "@/lib/governance";

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
  return NextResponse.json({ error: status === 401 ? "Authentication required." : status === 403 ? "Institution governance access required." : "Unable to process governance request." }, { status });
}

export async function GET(request: Request) {
  try {
    const { profile } = await authenticate(request);
    const params = new URL(request.url).searchParams;
    const findings = await adminDb!.collection("governanceFindings").where("institutionId", "==", profile.institutionId).get();
    const chains = await adminDb!.collection("governanceChains").where("institutionId", "==", profile.institutionId).get();
    return NextResponse.json({
      findings: findings.docs.map((doc) => doc.data()).filter((finding) => !params.get("status") || finding.status === params.get("status")),
      chains: chains.docs.map((doc) => doc.data()),
      stages: ["Requirement", "Policy", "Department", "Training", "Audit", "Finding", "Corrective Action", "Verification"],
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { decoded, profile } = await authenticate(request);
    const body = await request.json() as { action?: string; finding?: Finding; nextStatus?: FindingStatus; reason?: string; scope?: string[]; durationMinutes?: number };
    if (body.action === "transition_finding" && body.finding && body.nextStatus) {
      if (!["Owner", "Admin", "Manager"].includes(profile.role)) return NextResponse.json({ error: "Governance finding management is restricted." }, { status: 403 });
      if (body.finding.institutionId !== profile.institutionId) return NextResponse.json({ error: "Institution scope cannot be changed." }, { status: 403 });
      const finding = transitionFinding(body.finding, body.nextStatus);
      await adminDb!.collection("governanceFindings").doc(finding.findingId).set({ ...finding, updatedBy: decoded.uid }, { merge: true });
      return NextResponse.json({ finding });
    }
    if (body.action === "break_glass") {
      if (!["Owner", "Admin"].includes(profile.role)) return NextResponse.json({ error: "Only owners and administrators may grant break-glass access." }, { status: 403 });
      const access = createBreakGlassAccess({ institutionId: profile.institutionId, uid: decoded.uid, reason: body.reason ?? "", scope: body.scope ?? [], grantedBy: decoded.uid, durationMinutes: body.durationMinutes ?? 0 });
      await adminDb!.collection("breakGlassAccess").doc(access.accessId).set({ ...access, createdAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ access }, { status: 201 });
    }
    return NextResponse.json({ error: "Unsupported governance action." }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
