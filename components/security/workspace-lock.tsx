"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function WorkspaceLock({
  email,
  onUnlock,
}: {
  email?: string;
  onUnlock: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!password.trim()) {
      setError("Password is required to unlock.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onUnlock(password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to unlock this workspace.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-5">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-7 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Workspace locked</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Unlock Veqweris</h1>
        <p className="mt-2 text-sm text-muted">Session is still active. Re-enter your password to continue.</p>
        <div className="mt-5 rounded-md border border-line bg-surface-raised px-3 py-2 text-sm text-muted">
          {email || "Signed-in user"}
        </div>
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          className="mt-4"
        />
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <Button type="button" className="mt-5 w-full bg-accent text-white" onClick={() => void submit()} disabled={busy}>
          {busy ? "Unlocking…" : "Unlock workspace"}
        </Button>
      </div>
    </div>
  );
}
