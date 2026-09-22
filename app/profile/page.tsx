"use client";

import { doc, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/page-header";
import { SensitiveActionGuard } from "@/components/security/sensitive-action-guard";
import { useAuth } from "@/lib/auth-context";
import { db } from "@/lib/firebase/client";
import { SESSION_POLICY_OPTIONS } from "@/lib/identity";

export default function ProfilePage() {
  const { profile, user, sessionPolicy, updateSessionPolicy, savePreferences, lockWorkspace } = useAuth();
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", photoUrl: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setForm({
      fullName: profile.fullName ?? "",
      email: profile.email ?? "",
      phone: profile.phone ?? "",
      photoUrl: profile.photoUrl ?? "",
    });
  }, [profile]);

  if (!profile || !user) return null;

  async function saveProfile() {
    if (!profile) return;
    setSaving(true);
    try {
      await setDoc(doc(db!, "users", profile.uid), {
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        photoUrl: form.photoUrl,
      }, { merge: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Identity"
        title="My profile"
        description="Manage your personal details, account session policy, and workspace security posture."
        breadcrumbs={[{ label: "Workspace", href: "/" }, { label: "Profile" }]}
        actions={<Button type="button" onClick={() => lockWorkspace()}>Lock workspace</Button>}
      />

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-5">
          <h2 className="text-lg font-semibold text-ink">Profile details</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-muted">Full name</label>
              <Input value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-muted">Email</label>
              <Input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-muted">Phone</label>
              <Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-muted">Profile photo URL</label>
              <Input value={form.photoUrl} onChange={(event) => setForm((current) => ({ ...current, photoUrl: event.target.value }))} />
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <Button type="button" className="bg-accent text-white" onClick={() => void saveProfile()} disabled={saving}>{saving ? "Saving…" : "Save profile"}</Button>
            <SensitiveActionGuard actionLabel="Confirm profile verification" onConfirm={async () => { await saveProfile(); }}>
              <Button type="button">Security review</Button>
            </SensitiveActionGuard>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-lg font-semibold text-ink">Account summary</h2>
          <dl className="mt-4 space-y-3 text-sm text-muted">
            <div className="flex justify-between gap-3"><dt>Role</dt><dd className="font-medium text-ink">{profile.role}</dd></div>
            <div className="flex justify-between gap-3"><dt>Department</dt><dd className="font-medium text-ink">{profile.departmentId ?? "Unassigned"}</dd></div>
            <div className="flex justify-between gap-3"><dt>Institution</dt><dd className="font-medium text-ink">{profile.institutionId}</dd></div>
            <div className="flex justify-between gap-3"><dt>Status</dt><dd className="font-medium text-ink">{profile.status}</dd></div>
            <div className="flex justify-between gap-3"><dt>Security</dt><dd className="font-medium text-ink">{profile.securityStatus ?? "standard"}</dd></div>
          </dl>
        </Card>
      </div>

      <Card className="mt-5 p-5">
        <h2 className="text-lg font-semibold text-ink">Session security</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
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
            <label className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-muted">Workspace lock</label>
            <Button type="button" className="mt-7" onClick={() => lockWorkspace()}>Lock now</Button>
          </div>
        </div>
      </Card>

      <Card className="mt-5 p-5">
        <h2 className="text-lg font-semibold text-ink">Preferences</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-muted">Theme</label>
            <select
              className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink"
              value={profile.preferences?.theme ?? "dark"}
              onChange={(event) => void savePreferences({ ...(profile.preferences ?? {}), theme: event.target.value as "dark" | "light" })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-muted">Language</label>
            <Input value={profile.preferences?.language ?? "en"} onChange={(event) => void savePreferences({ ...(profile.preferences ?? {}), language: event.target.value })} />
          </div>
        </div>
      </Card>
    </div>
  );
}
