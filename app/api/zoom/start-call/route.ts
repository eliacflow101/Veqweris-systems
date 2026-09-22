import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebase/admin";

export async function POST() {
  if (!process.env.ZOOM_ACCOUNT_ID || !process.env.ZOOM_CLIENT_ID || !process.env.ZOOM_CLIENT_SECRET) {
    return NextResponse.json({ error: "Zoom is not yet configured" }, { status: 503 });
  }
  try {
    const token = (await cookies()).get("__session")?.value;
    if (!token || !adminAuth) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    await adminAuth.verifyIdToken(token);
    const credentials = Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString("base64");
    const accessResponse = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(process.env.ZOOM_ACCOUNT_ID)}`, { method: "POST", headers: { Authorization: `Basic ${credentials}` } });
    if (!accessResponse.ok) return NextResponse.json({ error: "Zoom authentication failed." }, { status: 502 });
    const access = await accessResponse.json() as { access_token?: string };
    if (!access.access_token) return NextResponse.json({ error: "Zoom authentication returned no access token." }, { status: 502 });
    const meetingResponse = await fetch("https://api.zoom.us/v2/users/me/meetings", { method: "POST", headers: { Authorization: `Bearer ${access.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ topic: "Veqweris Systems call", type: 1 }) });
    if (!meetingResponse.ok) return NextResponse.json({ error: "Zoom could not create the meeting." }, { status: 502 });
    const meeting = await meetingResponse.json() as { join_url?: string };
    return meeting.join_url ? NextResponse.json({ joinUrl: meeting.join_url }) : NextResponse.json({ error: "Zoom returned no meeting link." }, { status: 502 });
  } catch (reason) {
    console.error("Unable to start Zoom call.", reason);
    return NextResponse.json({ error: "Unable to start Zoom call." }, { status: 500 });
  }
}
