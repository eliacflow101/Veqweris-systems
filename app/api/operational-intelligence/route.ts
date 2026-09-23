import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { buildOperationalCues, calculateOperationalLoad, createOperationalEvent, detectResourceConflicts, evaluateReadinessMatrix, simulateScenario } from "@/lib/operational-intelligence";

async function authenticate(request: Request) {
  if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
  const token = await getSessionToken(request);
  if (!token) throw new Error("UNAUTHENTICATED");
  const decoded = await verifyActiveSession(token);
  const profile = (await adminDb.collection("users").doc(decoded.uid).get()).data();
  if (!profile?.institutionId) throw new Error("FORBIDDEN");
  return { decoded, profile };
}
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const status = code === "SERVICE_UNAVAILABLE" ? 503 : code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : 400;
  return NextResponse.json({ error: status === 401 ? "Authentication required." : status === 403 ? "Institution operational intelligence access required." : "Unable to process operational intelligence request." }, { status });
}
export async function GET(request: Request) {
  try {
    const { profile } = await authenticate(request);
    const snapshot = await adminDb!.collection("operationalIntelligence").where("institutionId", "==", profile.institutionId).limit(200).get();
    const records = snapshot.docs.map((doc) => doc.data());
    const events = records.filter((record) => record.recordType === "event").map(({ recordType: _recordType, ...event }) => event) as Parameters<typeof calculateOperationalLoad>[0]["events"];
    const loads = events.length ? [calculateOperationalLoad({ institutionId: profile.institutionId, domain: "institution", events })] : [];
    const readiness = evaluateReadinessMatrix({ institutionId: profile.institutionId, cells: records.filter((record) => record.recordType === "readiness").map((record) => record.cell) });
    return NextResponse.json({ events, loads, cues: buildOperationalCues(loads), readiness, simulations: records.filter((record) => record.recordType === "simulation").map((record) => record.simulation), conflicts: records.filter((record) => record.recordType === "conflict").map((record) => record.conflict) });
  } catch (error) { console.error("Unable to load operational intelligence.", error); return failure(error); }
}
export async function POST(request: Request) {
  try {
    const { decoded, profile } = await authenticate(request);
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "event") {
      const event = createOperationalEvent({ institutionId: profile.institutionId, kind: body.kind as never, type: String(body.type), actorUid: decoded.uid, occurredAt: String(body.occurredAt ?? new Date().toISOString()), payload: (body.payload ?? {}) as Record<string, unknown> });
      await adminDb!.collection("operationalIntelligence").doc(event.eventId).set({ recordType: "event", ...event, createdAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ event }, { status: 201 });
    }
    if (body.action === "simulation") {
      const simulation = simulateScenario({ institutionId: profile.institutionId, label: String(body.label), scenario: String(body.scenario), assumptions: Array.isArray(body.assumptions) ? body.assumptions.map(String) : [], outcomes: Array.isArray(body.outcomes) ? body.outcomes.map(String) : [] });
      await adminDb!.collection("operationalIntelligence").doc(simulation.simulationId).set({ recordType: "simulation", simulation, createdBy: decoded.uid, createdAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ simulation }, { status: 201 });
    }
    return NextResponse.json({ error: "Unsupported operational intelligence action." }, { status: 400 });
  } catch (error) { console.error("Unable to write operational intelligence.", error); return failure(error); }
}
