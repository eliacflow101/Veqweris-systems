import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { canReadMetric, createSnapshot, getMetric, metricRegistry, type ReportFilters } from "@/lib/analytics";

async function auth(request: Request) {
  if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
  const token = await getSessionToken(request);
  if (!token) throw new Error("UNAUTHENTICATED");
  const decoded = await verifyActiveSession(token);
  const profile = (await adminDb.collection("users").doc(decoded.uid).get()).data();
  if (!profile?.institutionId) throw new Error("FORBIDDEN");
  return { decoded, profile };
}

function errorResponse(reason: unknown) {
  const code = reason instanceof Error ? reason.message : "";
  const status = code === "SERVICE_UNAVAILABLE" ? 503 : code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : 400;
  return NextResponse.json({ error: status === 401 ? "Authentication required." : status === 403 ? "Institution analytics access required." : "Unable to process analytics request." }, { status });
}

function canUseScope(profile: { role?: string; departmentId?: string | null }, filters: ReportFilters) {
  if (filters.scope !== "department") return true;
  if (!filters.departmentId) return false;
  return ["Owner", "Admin"].includes(profile.role ?? "") || profile.departmentId === filters.departmentId;
}

export async function GET(request: Request) {
  try {
    const { profile } = await auth(request);
    const params = new URL(request.url).searchParams;
    const requested = params.get("metricId")?.split(",").filter(Boolean);
    const metrics = metricRegistry.filter((metric) =>
      (!requested?.length || requested.includes(metric.metricId))
      && (!params.get("domain") || metric.domain === params.get("domain"))
      && canReadMetric(metric, profile.role),
    );
    const filters: ReportFilters = {
      metricIds: metrics.map((metric) => metric.metricId),
      domain: params.get("domain") as ReportFilters["domain"] | undefined,
      periodStart: params.get("periodStart") ?? undefined, periodEnd: params.get("periodEnd") ?? undefined,
      departmentId: params.get("departmentId") ?? undefined,
      scope: params.get("scope") === "department" ? "department" : "institution",
    };
    if (!canUseScope(profile, filters)) {
      return NextResponse.json({ error: "Department scope is limited to your authorized department." }, { status: 403 });
    }
    const snapshotQuery = adminDb!.collection("analyticsSnapshots").where("institutionId", "==", profile.institutionId);
    const snapshotDocs = await snapshotQuery.get();
    const snapshots = snapshotDocs.docs.map((doc) => doc.data()).filter((snapshot) =>
      metrics.some((metric) => metric.metricId === snapshot.metricId)
      && (!filters.departmentId || snapshot.departmentId === filters.departmentId)
      && (!filters.periodStart || snapshot.periodEnd >= filters.periodStart)
      && (!filters.periodEnd || snapshot.periodStart <= filters.periodEnd),
    );
    return NextResponse.json({
      metrics,
      filters,
      snapshots,
      state: snapshots.length ? "ready" : "no_data",
      noDataReason: snapshots.length ? undefined : "No snapshots match the selected institution and filters.",
    });
  } catch (reason) {
    console.error("Unable to load analytics.", reason);
    return errorResponse(reason);
  }
}

export async function POST(request: Request) {
  try {
    const { profile } = await auth(request);
    if (!["Owner", "Admin"].includes(profile.role)) return NextResponse.json({ error: "Only owners and administrators can publish snapshots." }, { status: 403 });
    const body = await request.json() as Omit<Parameters<typeof createSnapshot>[0], "institutionId"> & { institutionId?: string };
    const metric = getMetric(body.metricId);
    if (!metric || !canReadMetric(metric, profile.role)) return NextResponse.json({ error: "Metric is unavailable for this role." }, { status: 403 });
    if (body.institutionId && body.institutionId !== profile.institutionId) return NextResponse.json({ error: "Institution scope cannot be changed." }, { status: 403 });
    const filters = body.filters ?? { metricIds: [body.metricId], scope: body.scope ?? "institution" };
    if (!canUseScope(profile, filters)) {
      return NextResponse.json({ error: "Department scope is limited to your authorized department." }, { status: 403 });
    }
    const snapshot = createSnapshot({ ...body, institutionId: profile.institutionId });
    await adminDb!.collection("analyticsSnapshots").doc(snapshot.snapshotId).set({ ...snapshot, publishedBy: profile.uid, publishedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ snapshot }, { status: 201 });
  } catch (reason) {
    console.error("Unable to publish analytics snapshot.", reason);
    return errorResponse(reason);
  }
}
