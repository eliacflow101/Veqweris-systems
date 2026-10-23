import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { createAuditEvent } from "@/lib/governance";
import { bootstrapEmails, canBootstrapOperator } from "@/lib/platform";

/**
 * First-run platform bootstrap.
 *
 * This is the only platform endpoint that does not require an existing operator,
 * because it exists to create the very first one. It is deliberately narrow:
 *  - the caller must hold a valid, registered session,
 *  - the caller's verified email must appear in `PLATFORM_BOOTSTRAP_EMAILS`,
 *  - it only succeeds while no active platform operator exists,
 *  - the created operator is always `Platform Owner`.
 */
async function decide(request: Request) {
  if (!adminDb) return { status: 503 as const, body: { error: "Platform service is unavailable." } };
  const token = await getSessionToken(request);
  if (!token) return { status: 401 as const, body: { error: "Authentication required." } };
  const decoded = await verifyActiveSession(token);
  const active = await adminDb.collection("platformOperators").where("status", "==", "active").count().get();
  const decision = canBootstrapOperator({
    email: decoded.email,
    emailVerified: Boolean(decoded.email_verified),
    activeOperatorCount: active.data().count,
    allowlist: bootstrapEmails(process.env.PLATFORM_BOOTSTRAP_EMAILS),
  });
  return { status: 200 as const, body: { decision, decoded } };
}

export async function GET(request: Request) {
  try {
    const result = await decide(request);
    if (result.status !== 200) return NextResponse.json(result.body, { status: result.status });
    return NextResponse.json({ bootstrap: { allowed: result.body.decision.allowed, reason: result.body.decision.reason } });
  } catch {
    return NextResponse.json({ bootstrap: { allowed: false, reason: "Bootstrap eligibility could not be verified." } });
  }
}

export async function POST(request: Request) {
  try {
    const result = await decide(request);
    if (result.status !== 200) return NextResponse.json(result.body, { status: result.status });
    const { decision, decoded } = result.body;
    if (!decision.allowed) return NextResponse.json({ error: decision.reason }, { status: 403 });
    const uid = decoded.uid;
    const email = String(decoded.email ?? "").toLowerCase();
    const operatorRef = adminDb!.collection("platformOperators").doc(uid);
    const lockRef = adminDb!.collection("platformBootstrap").doc("initial-owner");
    const auditRef = adminDb!.collection("platformAuditEvents").doc(`platform_bootstrap_${uid}`);
    const auditHeadRef = adminDb!.collection("platformMetadata").doc("auditHead");
    const transactionResult = await adminDb!.runTransaction(async (transaction) => {
      const lock = await transaction.get(lockRef);
      const active = await transaction.get(adminDb!.collection("platformOperators").where("status", "==", "active"));
      const currentDecision = canBootstrapOperator({
        email,
        emailVerified: Boolean(decoded.email_verified),
        activeOperatorCount: active.size,
        allowlist: bootstrapEmails(process.env.PLATFORM_BOOTSTRAP_EMAILS),
      });
      if (lock.exists || !currentDecision.allowed) return false;
      const now = new Date().toISOString();
      const event = createAuditEvent({
        eventId: `platform_bootstrap_${uid}`, institutionId: "platform", actorUid: uid,
        action: "platform.bootstrap", resourceType: "platformOperator", resourceId: uid,
        payload: { platformRole: "Platform Owner" }, occurredAt: now,
        previousHash: null, sequence: 0,
      });
      transaction.create(lockRef, { uid, email, createdAt: FieldValue.serverTimestamp() });
      transaction.create(operatorRef, {
        uid, email, displayName: typeof decoded.name === "string" ? decoded.name : "",
        platformRole: "Platform Owner", status: "active", grantedBy: uid,
        grantReason: "First-run platform bootstrap.", grantedAt: now,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(auditRef, {
        ...event, scope: "platform", institutionId: "platform",
        actorUid: uid, actorEmail: email, actorPlatformRole: "Platform Owner",
        targetInstitutionId: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.create(auditHeadRef, { sequence: 0, hash: event.hash, updatedAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (!transactionResult) return NextResponse.json({ error: "Platform bootstrap is no longer available." }, { status: 409 });
    return NextResponse.json({ operator: { uid, platformRole: "Platform Owner", status: "active" } }, { status: 201 });
  } catch (error) {
    console.error("Platform bootstrap failed.", error);
    return NextResponse.json({ error: "Platform bootstrap could not be completed." }, { status: 400 });
  }
}