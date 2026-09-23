import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { buildSetupRequirements, calculateSetupProgress, defaultSetupConfig, evaluateSetupRequirements, recommendDepartments, transitionSetupRequirement, type DepartmentRecommendation, type SetupModule, type SetupRequirement, type SetupState } from "@/lib/setup";

async function authenticate(request: Request) {
  if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
  const token = await getSessionToken(request);
  if (!token) throw new Error("UNAUTHENTICATED");
  const decoded = await verifyActiveSession(token);
  const profile = (await adminDb.collection("users").doc(decoded.uid).get()).data();
  if (!profile?.institutionId || profile.status === "inactive") throw new Error("FORBIDDEN");
  if (!["Owner", "Admin", "Manager"].includes(profile.role)) throw new Error("FORBIDDEN");
  return { decoded, profile };
}

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const status = code === "SERVICE_UNAVAILABLE" ? 503 : code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : 400;
  return NextResponse.json({ error: status === 401 ? "Authentication required." : status === 403 ? "Setup access is restricted to institution operators." : "Unable to process setup request." }, { status });
}

export async function GET(request: Request) {
  try {
    const { profile } = await authenticate(request);
    const institutionId = profile.institutionId as string;
    const configSnapshot = await adminDb!.collection("setupConfigs").doc(institutionId).get();
    const config = configSnapshot.exists ? configSnapshot.data() as ReturnType<typeof defaultSetupConfig> : defaultSetupConfig(institutionId);
    const requirementsSnapshot = await adminDb!.collection("setupRequirements").where("institutionId", "==", institutionId).get();
    const requirements = buildSetupRequirements(institutionId, config, requirementsSnapshot.docs.map((doc) => doc.data() as SetupRequirement));
    const collectionNames = ["academicYears", "academicLevels", "schoolClasses", "schoolSubjects", "hotelRooms"];
    const [institutionSnapshot, usersSnapshot, departmentsSnapshot, ...moduleSnapshots] = await Promise.all([
      adminDb!.collection("institutions").doc(institutionId).get(),
      adminDb!.collection("users").where("institutionId", "==", institutionId).get(),
      adminDb!.collection("departments").where("institutionId", "==", institutionId).get(),
      ...collectionNames.map((name) => adminDb!.collection(name).where("institutionId", "==", institutionId).limit(1).get()),
    ]);
    const institution = institutionSnapshot.data() ?? {};
    const evidence = {
      institutionExists: institutionSnapshot.exists,
      institutionProfileComplete: Boolean(institution.name && institution.country),
      activeUsers: usersSnapshot.docs.map((doc) => ({ role: doc.data().role, status: doc.data().status })),
      departmentCount: departmentsSnapshot.size,
      collections: Object.fromEntries(collectionNames.map((name, index) => [name, moduleSnapshots[index].size])),
    };
    const verifiedRequirements = evaluateSetupRequirements(requirements, config, evidence);
    const savedRecommendations = await adminDb!.collection("setupRecommendations").where("institutionId", "==", institutionId).get();
    const saved = new Map(savedRecommendations.docs.map((doc) => [doc.id, doc.data() as DepartmentRecommendation]));
    const recommendations = recommendDepartments(config.institutionType).map((item) => ({ ...item, ...(saved.get(item.recommendationId) ?? {}) }));
    return NextResponse.json({ config, requirements: verifiedRequirements, recommendations, progress: calculateSetupProgress(verifiedRequirements) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const { decoded, profile } = await authenticate(request);
    const institutionId = profile.institutionId as string;
    const body = await request.json() as { action?: string; requirementId?: string; state?: SetupState; institutionType?: SetupModule; enabledModules?: SetupModule[]; recommendationId?: string; recommendationState?: "Accepted" | "Dismissed" | "Needs Review" };
    if (body.action === "update_requirement" && body.requirementId && body.state) {
      if (body.state === "Completed") return NextResponse.json({ error: "Completed is derived from verified institution data." }, { status: 400 });
      const current = (await adminDb!.collection("setupRequirements").doc(body.requirementId).get()).data() as SetupRequirement | undefined;
      if (current && current.institutionId !== institutionId) return NextResponse.json({ error: "Institution scope cannot be changed." }, { status: 403 });
      const requirement = transitionSetupRequirement(current ?? { requirementId: body.requirementId, institutionId, dimension: "Institution", title: body.requirementId, description: "", module: "generic", order: 0, state: "Required" }, body.state, decoded.uid);
      await adminDb!.collection("setupRequirements").doc(requirement.requirementId).set({ ...requirement, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return NextResponse.json({ requirement });
    }
    if (body.action === "review_recommendation" && body.recommendationId && body.recommendationState) {
      const allowed = ["Recommended", "Accepted", "Dismissed", "Needs Review"];
      if (!allowed.includes(body.recommendationState)) return NextResponse.json({ error: "Invalid recommendation state." }, { status: 400 });
      const recommendation = { recommendationId: body.recommendationId, institutionId, state: body.recommendationState, reviewedBy: decoded.uid, reviewedAt: FieldValue.serverTimestamp() };
      await adminDb!.collection("setupRecommendations").doc(body.recommendationId).set(recommendation, { merge: true });
      return NextResponse.json({ recommendation });
    }
    if (body.action === "update_config") {
      const institutionType = body.institutionType ?? "generic";
      const config = { institutionId, institutionType, enabledModules: body.enabledModules ?? (institutionType === "generic" ? [] : [institutionType]), updatedAt: FieldValue.serverTimestamp() };
      await adminDb!.collection("setupConfigs").doc(institutionId).set(config, { merge: true });
      return NextResponse.json({ config });
    }
    return NextResponse.json({ error: "Unsupported setup action." }, { status: 400 });
  } catch (error) { return failure(error); }
}
