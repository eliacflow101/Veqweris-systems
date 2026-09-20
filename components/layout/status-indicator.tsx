"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db, firebaseConfigured } from "@/lib/firebase/client";
import type { ConnectionState } from "@/types";
import { useAuth } from "@/lib/auth-context";

export function StatusIndicator() {
  const [state, setState] = useState<ConnectionState>("checking");
  const { user } = useAuth();

  useEffect(() => {
    if (!firebaseConfigured || !db || !user) {
      setState("offline");
      return;
    }

    const timeout = window.setTimeout(() => setState("offline"), 8000);
    const unsubscribe = onSnapshot(
      doc(db, "users", user.uid),
      { includeMetadataChanges: true },
      (snapshot) => {
        window.clearTimeout(timeout);
        setState(snapshot.metadata.fromCache ? "offline" : "online");
      },
      () => {
        window.clearTimeout(timeout);
        setState("offline");
      },
    );

    return () => {
      window.clearTimeout(timeout);
      unsubscribe();
    };
  }, [user]);

  const isOnline = state === "online";
  const label = isOnline ? "System Live" : state === "checking" ? "Checking Connection" : "Weak Connection";
  const color = isOnline ? "bg-success" : state === "checking" ? "bg-warning" : "bg-danger";
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-muted" aria-live="polite">
      <span className={`h-2 w-2 rounded-full ${color} ${isOnline ? "status-pulse" : ""}`} />
      <span>{label}</span>
      {!isOnline && state !== "checking" && <span className="sr-only">Firestore connectivity is unavailable.</span>}
    </div>
  );
}
