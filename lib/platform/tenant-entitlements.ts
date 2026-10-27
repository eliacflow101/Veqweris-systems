import { navigationConfig } from "@/lib/navigation";
import { adminDb } from "@/lib/firebase/admin";
import { readPlatformState, tenantModuleCatalogue } from "@/lib/platform";
import type { Transaction } from "firebase-admin/firestore";
import { loadManagedPlanCatalogInTransaction } from "./managed-catalog";
import { loadManagedPlanCatalog } from "@/lib/platform/managed-catalog";
import type { PlanFeature } from "@/lib/platform";

const tenantModules = tenantModuleCatalogue(navigationConfig);
export async function institutionHasModuleEntitlement(institutionId: string, moduleId: string): Promise<boolean> {
  if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
  const snapshot = await adminDb.collection("institutions").doc(institutionId).get();
  if (!snapshot.exists) return false;
  const plans = await loadManagedPlanCatalog(adminDb, "tenant-entitlement-reader");
  const state = readPlatformState(institutionId, snapshot.data() ?? {}, { tenantModules, plans });
  return state.status === "active" && state.entitlement.modules.includes(moduleId);
}

export async function institutionHasModuleEntitlementInTransaction(
  transaction: Transaction,
  institutionId: string,
  moduleId: string,
): Promise<boolean> {
  if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
  const institutionSnapshot = await transaction.get(adminDb.collection("institutions").doc(institutionId));
  if (!institutionSnapshot.exists || institutionSnapshot.get("status") !== "active") return false;
  const plans = await loadManagedPlanCatalogInTransaction(transaction, adminDb);
  const state = readPlatformState(institutionId, institutionSnapshot.data() ?? {}, { tenantModules, plans });
  return state.status === "active" && state.entitlement.modules.includes(moduleId);
}

export async function institutionHasFeatureEntitlement(institutionId: string, feature: PlanFeature): Promise<boolean> {
  if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
  const snapshot = await adminDb.collection("institutions").doc(institutionId).get();
  if (!snapshot.exists) return false;
  const plans = await loadManagedPlanCatalog(adminDb, "tenant-entitlement-reader");
  const state = readPlatformState(institutionId, snapshot.data() ?? {}, { tenantModules, plans });
  return state.status === "active" && state.entitlement.features.includes(feature);
}

export async function institutionIsActive(institutionId: string): Promise<boolean> {
  if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
  const snapshot = await adminDb.collection("institutions").doc(institutionId).get();
  return snapshot.exists && snapshot.get("status") === "active";
}

export async function requireInstitutionModuleEntitlement(institutionId: string, moduleId: string): Promise<void> {
  if (!await institutionHasModuleEntitlement(institutionId, moduleId)) throw new Error("FORBIDDEN");
}

export async function requireInstitutionFeatureEntitlement(institutionId: string, feature: PlanFeature): Promise<void> {
  if (!await institutionHasFeatureEntitlement(institutionId, feature)) throw new Error("FORBIDDEN");
}
