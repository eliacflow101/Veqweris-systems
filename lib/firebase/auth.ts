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

export async function createAccount(
  email: string,
  password: string,
  fullName: string,
  institutionName: string,
  country: string,
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
    createdAt: timestamp,
  });
  await batch.commit();
  await syncSessionCookie(credential.user);
  return credential.user;
}

export async function login(email: string, password: string) {
  if (!auth || !firebaseConfigured) throw new Error("Firebase is not configured.");
  const credential = await signInWithEmailAndPassword(auth, email, password);
  await syncSessionCookie(credential.user);
  return credential.user;
}

export async function signOut() {
  if (auth) await firebaseSignOut(auth);
  await fetch("/api/auth/session", { method: "DELETE" });
}

async function syncSessionCookie(user: User) {
  const token = await user.getIdToken();
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error("Unable to establish a secure session.");
}
