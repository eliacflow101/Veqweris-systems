import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionToken, verifyActiveSession } from "@/lib/firebase/server-auth";
import { hashIntegrationKey } from "@/lib/integrations";

const allowedScopes = new Set(["hospitality:bookings", "retail:orders"]);

async function authenticate(request: Request) {
  if (!adminDb) throw new Error("SERVICE_UNAVAILABLE");
  const token = await getSessionToken(request);
  if (!token) throw new Error("UNAUTHENTICATED");
  const decoded = await verifyActiveSession(token);
  const snapshot = await adminDb.collection("users").doc(decoded.uid).get();
  const profile = snapshot.data();
  if (!profile?.institutionId || !["Owner", "Admin"].includes(profile.role) || profile.status === "inactive") throw new Error("FORBIDDEN");
  return { uid: decoded.uid, profile };
}

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const status = code === "SERVICE_UNAVAILABLE" ? 503 : code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : 400;
  return NextResponse.json({ error: status === 401 ? "Authentication required." : status === 403 ? "Integration administration access required." : "Unable to process integration request." }, { status });
}

export async function GET(request: Request) {
  try {
    const { profile } = await authenticate(request);
    const snapshot = await adminDb!.collection("integrations").where("institutionId", "==", profile.institutionId).get();
    return NextResponse.json({ integrations: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const { uid, profile } = await authenticate(request);
    const body = await request.json() as { provider?: string; name?: string; scopes?: string[] };
    if (!body.provider || !body.name || !Array.isArray(body.scopes) || body.scopes.length === 0 || body.scopes.some((scope) => typeof scope !== "string" || !allowedScopes.has(scope))) {
      return NextResponse.json({ error: "provider, name and scopes are required." }, { status: 400 });
    }
    const integrationRef = adminDb!.collection("integrations").doc();
    const keyId = `vqi_${randomBytes(18).toString("base64url")}`;
    const secret = randomBytes(32).toString("hex");
    const now = FieldValue.serverTimestamp();
    const record = {
      integrationId: integrationRef.id, institutionId: profile.institutionId, provider: body.provider,
      name: body.name, status: "active", scopes: body.scopes, createdBy: uid, createdAt: now, updatedAt: now,
    };
    await integrationRef.create(record);
    await adminDb!.collection("integrationCredentials").doc(keyId).set({
      integrationId: integrationRef.id, institutionId: profile.institutionId, provider: body.provider,
      keyIdHash: hashIntegrationKey(keyId), secret, status: "active", scopes: body.scopes, createdAt: now, updatedAt: now,
    });
    // The secret is returned once and is never copied into the provider-neutral record.
    return NextResponse.json({ integration: record, credentials: { keyId, secret } }, { status: 201 });
  } catch (error) { return failure(error); }
}
