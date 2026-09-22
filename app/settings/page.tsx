"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { useAuth } from "@/lib/auth-context";
import { LOCK_TIMEOUT_OPTIONS, SESSION_POLICY_OPTIONS } from "@/lib/identity";

export default function SettingsPage() {
  const { profile, sessionPolicy, updateSessionPolicy, savePreferences, lockTimeout, lockWorkspace } = useAuth();

  if (!profile) return null;

  const preferences = profile.preferences ?? {};

  return (
    <div>
      <PageHeader
        eyebrow="Control"
        title="Workspace settings"
        description="Institution and identity preferences for session lifetime, lock behavior, and user experience."
        breadcrumbs={[{ label: "Workspace", href: "/" }, { label: "Settings" }]}
        actions={<Button type="button" onClick={() => lockWorkspace()}>Lock workspace</Button>}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-lg font-semibold text-ink">Session policy</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-muted">Session lifetime</label>
              <select
                className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink"
                value={sessionPolicy}
                onChange={(event) => void updateSessionPolicy(event.target.value as typeof sessionPolicy)}
              >
                {SESSION_POLICY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-muted">Workspace inactivity lock</label>
              <select
                className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink"
                value={lockTimeout}
                onChange={(event) => {
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem("veqweris-lock-timeout", event.target.value);
                  }
                  window.location.reload();
                }}
              >
                {LOCK_TIMEOUT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-lg font-semibold text-ink">Preferences</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-muted">Language</label>
              <Input value={preferences.language ?? "en"} onChange={(event) => void savePreferences({ ...preferences, language: event.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-muted">Timezone</label>
              <Input value={preferences.timezone ?? "UTC"} onChange={(event) => void savePreferences({ ...preferences, timezone: event.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-muted">Date format</label>
              <Input value={preferences.dateFormat ?? "MM/DD/YYYY"} onChange={(event) => void savePreferences({ ...preferences, dateFormat: event.target.value })} />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
