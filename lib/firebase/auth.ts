"use client";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth, firebaseConfigured } from "./client";
import { logSecurityEvent } from "./data";
import type { SessionPolicy } from "./models";

export async function createAccount(
  email: string,
  password: string,
  fullName: string,
  institutionName: string,
  country: string,
  sessionPolicy: SessionPolicy = "7_days",
) {
  if (!auth || !firebaseConfigured) throw new Error("Firebase is not configured.");
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { displayName: fullName });
  await syncSessionCookie(credential.user, sessionPolicy);

  const response = await fetch("/api/organization/provision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      institutionName,
      country,
      fullName,
      email,
      institutionType: "general-business",
      idempotencyKey: `${credential.user.uid}:${Date.now()}:signup`,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload.error === "string" ? payload.error : "Institution provisioning failed.");
  }

  const provisioning = await response.json() as { institutionId?: unknown };
  if (typeof provisioning.institutionId !== "string" || !provisioning.institutionId) {
    throw new Error("Institution provisioning returned an invalid response.");
  }
  await syncSessionCookie(credential.user, sessionPolicy, true);
  await logSecurityEvent({ institutionId: provisioning.institutionId, uid: credential.user.uid, type: "login", source: "create_account" });
  return credential.user;
}

export async function login(email: string, password: string, sessionPolicy: SessionPolicy = "7_days") {
  if (!auth || !firebaseConfigured) throw new Error("Firebase is not configured.");
  const credential = await signInWithEmailAndPassword(auth, email, password);
  await syncSessionCookie(credential.user, sessionPolicy);
  await logSecurityEvent({ institutionId: (await credential.user.getIdTokenResult()).claims.institutionId as string ?? "unknown", uid: credential.user.uid, type: "login", source: "login_form" });
  return credential.user;
}

export async function signOut() {
  if (auth) await firebaseSignOut(auth);
  await fetch("/api/auth/session", { method: "DELETE" });
}

async function syncSessionCookie(user: User, sessionPolicy: SessionPolicy = "7_days", forceRefresh = false) {
  const synchronize = async (token: string) => {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, sessionPolicy }),
    });
    if (!response.ok) throw new Error("Unable to establish a secure session.");
    return await response.json() as { refreshRequired?: boolean };
  };
  const result = await synchronize(await user.getIdToken(forceRefresh));
  if (result.refreshRequired) {
    await synchronize(await user.getIdToken(true));
  }
}
