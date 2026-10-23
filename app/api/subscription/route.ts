import { NextResponse } from "next/server";
import { navigationConfig } from "@/lib/navigation";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { canonicalPlanId, listPlans, readPlatformState, tenantModuleCatalogue } from "@/lib/platform";
import { loadManagedPlanCatalog } from "@/lib/platform/managed-catalog";

const tenantModules = tenantModuleCatalogue(navigationConfig);
/**
 * Institution-facing subscription summary.
 *
 * Institutions only ever see commercial plans and their own effective
 * entitlement. Internal and Partner plans are platform-managed and are never
 * disclosed to commercial customers.
 */
export async function GET(request: Request) {
  try {
    if (!adminDb) return NextResponse.json({ error: "Service is unavailable." }, { status: 503 });
    const token = await getSessionToken(request);
    if (!token) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const decoded = await verifyActiveSession(token);
    const profile = (await adminDb.collection("users").doc(decoded.uid).get()).data();
    if (!profile?.institutionId || profile.status !== "active") {
      return NextResponse.json({ error: "Institution workspace access required." }, { status: 403 });
    }
    const institutionSnapshot = await adminDb.collection("institutions").doc(profile.institutionId).get();
    if (!institutionSnapshot.exists) return NextResponse.json({ error: "Institution workspace access required." }, { status: 403 });
    const plans = await loadManagedPlanCatalog(adminDb, decoded.uid);
    const state = readPlatformState(profile.institutionId, institutionSnapshot.data() as Record<string, unknown>, { tenantModules, plans });
    if (state.status !== "active") return NextResponse.json({ error: "Institution workspace access required." }, { status: 403 });
    const billingVisible = state.subscription.category === "commercial";
    return NextResponse.json({
      institutionId: profile.institutionId,
      plan: {
        planId: canonicalPlanId(state.planTier),
        name: state.subscription.planName,
        category: state.subscription.category,
        status: state.subscription.status,
        billingEnabled: state.subscription.billingEnabled,
        invoicesEnabled: state.subscription.invoicesEnabled,
        // Feature content is private to the platform for non-commercial plans.
        premiumFeatures: billingVisible ? state.subscription.premiumFeatures : undefined,
        renewalPolicy: state.subscription.renewalPolicy,
      },
      entitlement: {
        modules: state.entitlement.modules,
        features: state.entitlement.features,
        limits: state.entitlement.limits,
      },
      billing: billingVisible
        ? { status: state.billingState.status, currency: state.billingState.currency, invoicesEnabled: state.billingState.invoicesEnabled, nextInvoiceAt: state.billingState.nextInvoiceAt ?? null }
        : { status: state.billingState.status, currency: state.billingState.currency, invoicesEnabled: false, nextInvoiceAt: null },
      status: state.status,
      plans: listPlans("customer", plans).map((plan) => ({
        planId: plan.planId, name: plan.name, description: plan.description,
        moduleScope: plan.moduleScope, limits: plan.limits,
      })),
    });
  } catch (error) {
    console.error("Unable to load the institution subscription.", error);
    return NextResponse.json({ error: "Unable to load the institution subscription." }, { status: 400 });
  }
}