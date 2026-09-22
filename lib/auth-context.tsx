"use client";

import { onAuthStateChanged, signInWithEmailAndPassword, type User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { auth, firebaseConfigured } from "@/lib/firebase/client";
import { db } from "@/lib/firebase/client";
import { logSecurityEvent, saveUserPreferences } from "@/lib/firebase/data";
import type { LockTimeout, SessionPolicy, UserPreferences, UserProfile } from "@/lib/firebase/models";
import { getLockTimeoutMs } from "@/lib/identity";

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  configured: boolean;
  profileError: string | null;
  retryProfile: () => void;
  locked: boolean;
  lockTimeout: LockTimeout;
  sessionPolicy: SessionPolicy;
  preferences: UserPreferences | null;
  lockWorkspace: () => void;
  unlockWorkspace: (password: string) => Promise<void>;
  updateSessionPolicy: (policy: SessionPolicy) => Promise<void>;
  savePreferences: (prefs: UserPreferences) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  configured: firebaseConfigured,
  profileError: null,
  retryProfile: () => undefined,
  locked: false,
  lockTimeout: "15_minutes",
  sessionPolicy: "7_days",
  preferences: null,
  lockWorkspace: () => undefined,
  unlockWorkspace: async () => undefined,
  updateSessionPolicy: async () => undefined,
  savePreferences: async () => undefined,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileRetry, setProfileRetry] = useState(0);
  const [locked, setLocked] = useState(false);
  const [lockTimeout, setLockTimeout] = useState<LockTimeout>("15_minutes");
  const [sessionPolicy, setSessionPolicy] = useState<SessionPolicy>("7_days");
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const retryProfile = useCallback(() => setProfileRetry((value) => value + 1), []);

  useEffect(() => {
    if (!profile) {
      setLocked(false);
      return;
    }
    const nextPolicy = profile.sessionPolicy ?? "7_days";
    const nextLock = (typeof window !== "undefined" && window.localStorage.getItem("veqweris-lock-timeout")) as LockTimeout | null;
    setSessionPolicy(nextPolicy);
    setLockTimeout(nextLock ?? "15_minutes");
    setPreferences(profile.preferences ?? null);
    setLocked(false);
  }, [profile]);

  useEffect(() => {
    const firestore = db;
    if (!auth || !firestore) { setLoading(false); return; }
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      if (!active) return;
      setUser(nextUser);
      setProfileError(null);
      setLoading(true);
      if (!nextUser) {
        setProfile(null);
        setLocked(false);
        setLoading(false);
        return;
      }

      try {
        const snapshot = await Promise.race([
          getDoc(doc(firestore, "users", nextUser.uid)),
          new Promise<never>((_, reject) =>
            window.setTimeout(() => reject(new Error("Profile request timed out after 10 seconds.")), 10000),
          ),
        ]);
        if (!active) return;
        if (snapshot.exists()) {
          const nextProfile = snapshot.data() as unknown as UserProfile;
          setProfile(nextProfile);
          setPreferences(nextProfile.preferences ?? null);
          setSessionPolicy(nextProfile.sessionPolicy ?? "7_days");
          void setDoc(doc(firestore, "users", nextUser.uid), { lastActive: serverTimestamp() }, { merge: true })
            .catch((reason: unknown) => console.error("Unable to update user activity timestamp.", reason));
        } else {
          setProfile(null);
        }
      } catch (reason) {
        if (!active) return;
        console.error("Unable to load the signed-in user profile.", reason);
        setProfile(null);
        setProfileError("We could not load your user profile. Check your connection and try again.");
      } finally {
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [profileRetry]);

  const lockWorkspace = useCallback(() => {
    if (!profile || !user) return;
    setLocked(true);
    void logSecurityEvent({
      institutionId: profile.institutionId,
      uid: user.uid,
      type: "workspace_lock",
      source: "workspace_lock",
      details: { patient: "none" },
    });
  }, [profile, user]);

  const unlockWorkspace = useCallback(async (password: string) => {
    if (!auth || !user?.email) throw new Error("Reauthentication is unavailable.");
    if (!password.trim()) throw new Error("Password is required.");
    await signInWithEmailAndPassword(auth, user.email, password);
    setLocked(false);
    if (profile) {
      await logSecurityEvent({
        institutionId: profile.institutionId,
        uid: user.uid,
        type: "workspace_unlock",
        source: "workspace_unlock",
      });
    }
  }, [profile, user]);

  const updateSessionPolicy = useCallback(async (policy: SessionPolicy) => {
    if (!user || !profile) return;
    setSessionPolicy(policy);
    await setDoc(doc(db!, "users", user.uid), { sessionPolicy: policy }, { merge: true });
    try {
      await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: await user.getIdToken(), sessionPolicy: policy }),
      });
    } catch (reason) {
      console.warn("Unable to update the server cookie for the session policy.", reason);
    }
  }, [profile, user]);

  const savePreferences = useCallback(async (nextPreferences: UserPreferences) => {
    if (!user || !profile) return;
    setPreferences(nextPreferences);
    await saveUserPreferences(user.uid, nextPreferences);
  }, [profile, user]);

  useEffect(() => {
    if (!user || !profile || locked) return;
    const timeoutMs = getLockTimeoutMs(lockTimeout);
    if (timeoutMs <= 0) return;
    const resetTimer = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        setLocked(true);
        void logSecurityEvent({
          institutionId: profile.institutionId,
          uid: user.uid,
          type: "workspace_lock",
          source: "idle_timer",
        });
      }, timeoutMs);
    };
    let idleTimer = window.setTimeout(() => {
      setLocked(true);
      void logSecurityEvent({
        institutionId: profile.institutionId,
        uid: user.uid,
        type: "workspace_lock",
        source: "idle_timer",
      });
    }, timeoutMs);
    const activityEvents = ["mousedown", "mousemove", "keydown", "touchstart", "scroll", "click"];
    for (const eventName of activityEvents) window.addEventListener(eventName, resetTimer, { passive: true });
    return () => {
      window.clearTimeout(idleTimer);
      for (const eventName of activityEvents) window.removeEventListener(eventName, resetTimer);
    };
  }, [locked, lockTimeout, profile, user]);

  const contextValue = useMemo<AuthContextValue>(() => ({
    user,
    profile,
    loading,
    configured: firebaseConfigured,
    profileError,
    retryProfile,
    locked,
    lockTimeout,
    sessionPolicy,
    preferences,
    lockWorkspace,
    unlockWorkspace,
    updateSessionPolicy,
    savePreferences,
  }), [user, profile, loading, profileError, retryProfile, locked, lockTimeout, sessionPolicy, preferences, lockWorkspace, unlockWorkspace, updateSessionPolicy, savePreferences]);

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
