"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { auth, firebaseConfigured } from "@/lib/firebase/client";
import { db } from "@/lib/firebase/client";
import type { UserProfile } from "@/lib/firebase/models";

type AuthContextValue = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  configured: boolean;
  profileError: string | null;
  retryProfile: () => void;
};
const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  configured: firebaseConfigured,
  profileError: null,
  retryProfile: () => undefined,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileRetry, setProfileRetry] = useState(0);
  const retryProfile = useCallback(() => setProfileRetry((value) => value + 1), []);

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
          setProfile(snapshot.data() as unknown as UserProfile);
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

  return <AuthContext.Provider value={{ user, profile, loading, configured: firebaseConfigured, profileError, retryProfile }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
