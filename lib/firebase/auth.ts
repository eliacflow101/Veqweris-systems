"use client";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { auth, db, firebaseConfigured } from "./client";
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
  if (!auth || !db || !firebaseConfigured) throw new Error("Firebase is not configured.");
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { displayName: fullName });
  const institutionRef = doc(collection(db, "institutions"));
  const userRef = doc(db, "users", credential.user.uid);
  const timestamp = serverTimestamp();
  const batch = writeBatch(db);
  batch.set(institutionRef, {
    institutionId: institutionRef.id,
    name: institutionName,
    country,
    status: "active",
    planTier: "trial",
    createdAt: timestamp,
  });
  batch.set(userRef, {
    uid: credential.user.uid,
    institutionId: institutionRef.id,
    fullName,
    email,
    role: "Owner",
    departmentId: null,
    lastActive: timestamp,
    status: "active",
    securityStatus: "standard",
    sessionPolicy,
    preferences: { theme: "dark", language: "en", timezone: "UTC", dateFormat: "MM/DD/YYYY", timeFormat: "24h", density: "comfortable" },
    createdAt: timestamp,
  });
  await batch.commit();
  await syncSessionCookie(credential.user, sessionPolicy);
  await logSecurityEvent({ institutionId: institutionRef.id, uid: credential.user.uid, type: "login", source: "create_account" });
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

async function syncSessionCookie(user: User, sessionPolicy: SessionPolicy = "7_days") {
  const token = await user.getIdToken();
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, sessionPolicy }),
  });
  if (!response.ok) throw new Error("Unable to establish a secure session.");
}
