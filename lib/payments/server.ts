import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { navigationConfig } from "@/lib/navigation";
import { readPlatformState, tenantModuleCatalogue } from "@/lib/platform";
import { loadManagedPlanCatalog } from "@/lib/platform/managed-catalog";

export async function requirePaymentOperator(request?: Request) {
  if (!adminAuth || !adminDb) throw new Error("Firebase server is not configured.");
  const token = request ? await getSessionToken(request) : (await cookies()).get("__session")?.value;
  if (!token) throw new Error("You must be signed in.");
  const decoded = await verifyActiveSession(token);
  const snapshot = await adminDb.collection("users").doc(decoded.uid).get();
  const profile = snapshot.data();
  if (!snapshot.exists || !profile?.institutionId || profile.status !== "active"
    || !["Owner", "Admin", "Billing"].includes(profile.role)) {
    throw new Error("Your account is not available.");
  }
  const institutionSnapshot = await adminDb.collection("institutions").doc(profile.institutionId).get();
  if (!institutionSnapshot.exists || institutionSnapshot.get("status") === "suspended") {
    throw new Error("Your institution is not available.");
  }
  const plans = await loadManagedPlanCatalog(adminDb);
  const state = readPlatformState(profile.institutionId, institutionSnapshot.data() ?? {}, {
    tenantModules: tenantModuleCatalogue(navigationConfig),
    plans,
  });
  if (state.status !== "active" || !state.entitlement.modules.includes("healthcare")
    || !state.subscription.billingEnabled || !state.subscription.invoicesEnabled) {
    throw new Error("Institution billing is not enabled.");
  }
  return { uid: decoded.uid, profile, db: adminDb };
}
