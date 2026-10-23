import type { Firestore } from "firebase-admin/firestore";
import { subscriptionPlans, validateManagedPlan } from "@/lib/platform/engine";
import type { SubscriptionPlan } from "@/lib/platform/models";

export async function loadManagedPlanCatalog(db: Firestore, _actorUid?: string): Promise<SubscriptionPlan[]> {
  const refs = subscriptionPlans.map((plan) => db.collection("platformPlanCatalog").doc(plan.planId));
  const snapshots = await Promise.all(refs.map((ref) => ref.get()));
  return snapshots.map((snapshot, index) => {
    const data = snapshot.data();
    if (!data) return subscriptionPlans[index];
    return validateManagedPlan({ ...data, planId: snapshot.id }, subscriptionPlans[index].planId);
  });
}
