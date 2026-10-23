import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { capabilitiesFor, isActivePlatformOperator, isSupportGrantActive, type PlatformOperator, type SupportAccessGrant } from "@/lib/platform";

/**
 * Lightweight platform-operator probe.
 *
 * Institution members always receive `{ operator: null }`: institution roles never
 * grant platform capabilities, and this endpoint never reveals other operators.
 */
export async function GET(request: Request) {
  try {
    if (!adminDb) return NextResponse.json({ operator: null, capabilities: [], activeSupportInstitutionIds: [] }, { status: 200 });
    const token = await getSessionToken(request);
    if (!token) return NextResponse.json({ operator: null, capabilities: [], activeSupportInstitutionIds: [] }, { status: 200 });
    const decoded = await verifyActiveSession(token);
    const snapshot = await adminDb.collection("platformOperators").doc(decoded.uid).get();
    const operator = snapshot.exists ? (snapshot.data() as PlatformOperator) : null;
    if (!isActivePlatformOperator(operator)) {
      return NextResponse.json({ operator: null, capabilities: [], activeSupportInstitutionIds: [] }, { status: 200 });
    }
    const grants = await adminDb.collection("platformSupportGrants").where("operatorUid", "==", decoded.uid).where("status", "==", "active").get();
    const activeSupportInstitutionIds = grants.docs
      .map((grant) => grant.data() as SupportAccessGrant)
      .filter((grant) => isSupportGrantActive(grant))
      .map((grant) => grant.institutionId);
    return NextResponse.json({
      operator: {
        uid: operator.uid,
        email: operator.email,
        platformRole: operator.platformRole,
        status: operator.status,
        grantedAt: operator.grantedAt,
      },
      capabilities: capabilitiesFor(operator.platformRole),
      activeSupportInstitutionIds: [...new Set(activeSupportInstitutionIds)],
    });
  } catch {
    // A probe failure is never an authorization grant.
    return NextResponse.json({ operator: null, capabilities: [], activeSupportInstitutionIds: [] }, { status: 200 });
  }
}
