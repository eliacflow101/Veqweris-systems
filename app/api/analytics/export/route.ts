import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { canReadMetric, getMetric, metricRegistry, type MetricSensitivity, type ReportFilters } from "@/lib/analytics";

const sensitivityRank: Record<MetricSensitivity, number> = { public: 0, internal: 1, confidential: 2, restricted: 3 };

function canUseScope(profile: { role?: string; departmentId?: string | null }, filters: ReportFilters) {
  if (filters.scope !== "department") return true;
  if (!filters.departmentId) return false;
  return ["Owner", "Admin"].includes(profile.role ?? "") || profile.departmentId === filters.departmentId;
}

export async function POST(request: Request) {
  try {
    if (!adminDb) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    const token = await getSessionToken(request);
    if (!token) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const decoded = await verifyActiveSession(token);
    const profile = (await adminDb.collection("users").doc(decoded.uid).get()).data();
    if (!profile?.institutionId) return NextResponse.json({ error: "Institution profile required." }, { status: 403 });
    const body = await request.json() as { filters?: ReportFilters; format?: "json" | "csv"; sensitivity?: MetricSensitivity };
    const filters = body.filters ?? {};
    const metrics = metricRegistry.filter((metric) =>
      (!filters.metricIds?.length || filters.metricIds.includes(metric.metricId))
      && (!filters.domain || filters.domain === metric.domain)
      && canReadMetric(metric, profile.role)
    );
    const requestedSensitivity = body.sensitivity ?? "internal";
    if (metrics.some((metric) => sensitivityRank[metric.sensitivity] > sensitivityRank[requestedSensitivity])) {
      return NextResponse.json({ error: "Requested export sensitivity exceeds the allowed scope." }, { status: 403 });
    }
    if (filters.scope === "department" && !filters.departmentId) return NextResponse.json({ error: "departmentId is required for department exports." }, { status: 400 });
    if (!canUseScope(profile, filters)) return NextResponse.json({ error: "Department scope is limited to your authorized department." }, { status: 403 });
    const docs = await adminDb.collection("analyticsSnapshots").where("institutionId", "==", profile.institutionId).get();
    const snapshots = docs.docs.map((doc) => doc.data()).filter((snapshot) => metrics.some((metric) => metric.metricId === snapshot.metricId)
      && (!filters.departmentId || snapshot.departmentId === filters.departmentId));
    const audit = {
      exportId: `${decoded.uid}_${Date.now()}`, institutionId: profile.institutionId, actorUid: decoded.uid,
      metricIds: metrics.map((metric) => metric.metricId), scope: filters.scope ?? "institution", sensitivity: requestedSensitivity,
      format: body.format ?? "json", filters, createdAt: new Date().toISOString(),
    };
    await adminDb.collection("analyticsExportAudit").doc(audit.exportId).set({ ...audit, createdAt: FieldValue.serverTimestamp() });
    if (body.format === "csv") {
      const rows = ["metricId,periodStart,periodEnd,value,status,departmentId", ...snapshots.map((snapshot) =>
        [snapshot.metricId, snapshot.periodStart, snapshot.periodEnd, snapshot.value ?? "", snapshot.status, snapshot.departmentId ?? ""].map((value) => JSON.stringify(value)).join(","))];
      return new NextResponse(rows.join("\n"), { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="analytics-${audit.exportId}.csv"` } });
    }
    return NextResponse.json({ exportId: audit.exportId, snapshots, metrics, state: snapshots.length ? "ready" : "no_data" });
  } catch (reason) {
    console.error("Unable to export analytics.", reason);
    return NextResponse.json({ error: "Unable to export analytics." }, { status: 400 });
  }
}
