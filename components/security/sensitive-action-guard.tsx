"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";

export function SensitiveActionGuard({
  actionLabel,
  onConfirm,
  children,
}: {
  actionLabel: string;
  onConfirm: () => Promise<void> | void;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmSensitiveAction() {
    if (!user?.email || !auth) {
      setError("Signed-in reauthentication is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, user.email, password);
      await onConfirm();
      setOpen(false);
      setPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reauthentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>{children}</span>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-line bg-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Sensitive action</p>
            <h3 className="mt-2 text-xl font-semibold text-ink">{actionLabel}</h3>
            <p className="mt-2 text-sm text-muted">Please re-enter your password to confirm this high-risk action.</p>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-4"
              placeholder="Current password"
            />
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="button" className="bg-accent text-white" disabled={busy || !password.trim()} onClick={() => void confirmSensitiveAction()}>
                {busy ? "Confirming…" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
