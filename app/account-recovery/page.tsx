"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function AccountRecoveryPage() {
  const [email, setEmail] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
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
      const response = await fetch("/api/auth/recovery/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, institutionId }),
      });
      const result = await response.json() as { error?: string; message?: string; token?: string };
      if (!response.ok) throw new Error(result.error || "Recovery could not be requested.");
      if (result.token) setToken(result.token);
      setStatus(result.token ? "Recovery token issued. Set a new password below." : result.message || "If the account exists, recovery instructions will be issued.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Recovery could not be validated.");
    } finally {
      setLoading(false);
    }

  }

  async function complete() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/recovery/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, institutionId, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to complete recovery.");
      setStatus("Password reset completed. Existing sessions were revoked; sign in again.");
      setToken("");
      setPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to complete recovery.");
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
          {token && <div className="space-y-3 border-t border-line pt-4">
            <Input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Recovery token" />
            <Input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password (8+ characters)" />
            <Button type="button" className="w-full bg-accent text-white" onClick={() => void complete()} disabled={loading || password.length < 8}>Set new password</Button>
          </div>}
        </div>
      </Card>
    </main>
  );
}
