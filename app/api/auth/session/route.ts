import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { getSessionMaxAgeSeconds } from "@/lib/identity";

export async function POST(request: Request) {
  try {
    const { token, sessionPolicy } = await request.json();
    if (!adminAuth) return NextResponse.json({ error: "Firebase server is not configured." }, { status: 503 });
    const decoded = await adminAuth.verifyIdToken(token);
    const maxAgeSeconds = getSessionMaxAgeSeconds(sessionPolicy ?? "7_days");
    const response = NextResponse.json({ uid: decoded.uid, sessionPolicy: sessionPolicy ?? "7_days" });
    response.cookies.set("__session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: maxAgeSeconds || 0,
    });
    return response;
  } catch { return NextResponse.json({ error: "Invalid authentication token." }, { status: 401 }); }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("__session", "", { httpOnly: true, expires: new Date(0), path: "/" });
  return response;
}
