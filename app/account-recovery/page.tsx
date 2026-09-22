"use client";

import { collection, getDocs, query, where } from "@firebase/firestore";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/firebase/client";

export default function AccountRecoveryPage() {
  const [email, setEmail] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email.trim() || !institutionId.trim()) {
      setError("Email and institution ID are required.");
      return;
    }
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      if (!db) throw new Error("Firebase is not configured.");
      const snapshot = await getDocs(query(collection(db, "users"), where("email", "==", email.trim().toLowerCase())));
      const userDoc = snapshot.docs[0]?.data() as { institutionId?: string; status?: string } | undefined;
      if (!userDoc) {
        setError("No matching institution account found for that email.");
        return;
      }
      if (userDoc.institutionId !== institutionId.trim()) {
        setError("Recovery request rejected: institution identity mismatch.");
        return;
      }
      if (userDoc.status && userDoc.status !== "active") {
        setError("This account is not active and cannot be recovered immediately.");
        return;
      }
      setStatus("Recovery verified. Use the institution-approved recovery flow to continue.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Recovery could not be validated.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-5">
      <Card className="w-full max-w-lg p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Account restoration</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Verify recovery identity</h1>
        <p className="mt-2 text-sm text-muted">Recovery is institution-scoped. Matching by email alone is not enough.</p>
        <div className="mt-5 space-y-4">
          <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" />
          <Input value={institutionId} onChange={(event) => setInstitutionId(event.target.value)} placeholder="Institution ID" />
          {error && <p className="text-sm text-danger">{error}</p>}
          {status && <p className="text-sm text-success">{status}</p>}
          <Button type="button" className="w-full bg-accent text-white" onClick={() => void submit()} disabled={loading}>{loading ? "Verifying…" : "Verify recovery"}</Button>
        </div>
      </Card>
    </main>
  );
}
