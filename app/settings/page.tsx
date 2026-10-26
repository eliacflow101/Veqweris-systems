"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState, PageHeader } from "@/components/shared/page-shell";
import { useAuth } from "@/lib/auth-context";
import { LOCK_TIMEOUT_OPTIONS, SESSION_POLICY_OPTIONS } from "@/lib/identity";
import { SETTINGS_CATEGORIES, SETTING_REGISTRY, type SettingDefinition, type SettingsCategory } from "@/lib/settings/registry";

type SectionId = "profile" | "notifications" | "security" | "locale";
type SettingsResponse = {
  sections: Record<string, { values?: Record<string, unknown> }>;
  capabilities: { whiteLabelFooter: boolean };
};

const CATEGORY_SECTION: Partial<Record<SettingsCategory, SectionId>> = {
  "Institution Profile & Branding": "profile",
  Notifications: "notifications",
  "Security & Access": "security",
  "Data, Locale & Compliance": "locale",
};

const CATEGORY_LINK: Partial<Record<SettingsCategory, string>> = {
  Organization: "/departments",
  "Workflows & Approvals": "/approvals",
  "Documents & Templates": "/documents",
};

const CATEGORY_EXPLANATION: Partial<Record<SettingsCategory, string>> = {
  Organization: "Manage the currently available departments and employees. Locations, operational units, teams, and roles are not yet fully configurable.",
  "Modules & Features": "The institution-type and module catalogs are being prepared. Server-enforced module activation and deactivation are not yet available.",
  "Workflows & Approvals": "Use the existing approvals workspace. Institution-wide workflow editing is not yet available here.",
  "Documents & Templates": "Manage documents in the existing workspace. Template studio is not yet available.",
  "Billing & Subscription": "The billing and subscription settings page is not available in this build.",
};

const initialResponse: SettingsResponse = { sections: {}, capabilities: { whiteLabelFooter: false } };

function displayedValue(setting: SettingDefinition, value: unknown): string | number | boolean {
  if (setting.type === "boolean") return typeof value === "boolean" ? value : Boolean(setting.defaultValue);
  if (setting.type === "integer") return typeof value === "number" ? value : Number(setting.defaultValue ?? setting.minimum ?? 0);
  if (setting.type === "string_list") return Array.isArray(value) ? value.join("\n") : "";
  if (typeof value === "string") return value;
  return typeof setting.defaultValue === "string" ? setting.defaultValue : "";
}

export default function SettingsPage() {
  const {
    profile, loading: authLoading, sessionPolicy, updateSessionPolicy, lockTimeout,
    lockWorkspace, preferences, savePreferences,
  } = useAuth();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(SETTINGS_CATEGORIES[0]);
  const [search, setSearch] = useState("");
  const [changes, setChanges] = useState<Record<string, string | boolean | number | string[]>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<{ sectionId: SectionId; draftId: string; values: Record<string, unknown> } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/settings", { cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? (response.status === 403 ? "Settings access is restricted." : "Unable to load settings."));
    }
    setData(await response.json() as SettingsResponse);
  }, []);

  useEffect(() => {
    if (!profile) return;
    void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "Unable to load settings."));
  }, [load, profile]);

  useEffect(() => {
    const hasChanges = Object.keys(changes).length > 0;
    if (!hasChanges) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [changes]);

  const sectionId = CATEGORY_SECTION[activeCategory];
  const sectionValues = sectionId ? data?.sections[sectionId]?.values ?? {} : {};
  const settings = useMemo(() => SETTING_REGISTRY.filter((setting) => {
    if (!sectionId || setting.sectionId !== sectionId) return false;
    return !search.trim() || `${setting.label} ${setting.key}`.toLowerCase().includes(search.trim().toLowerCase());
  }), [search, sectionId]);
  const relevantChanges = sectionId
    ? Object.fromEntries(Object.entries(changes).filter(([key]) => SETTING_REGISTRY.find((setting) => setting.key === key)?.sectionId === sectionId))
    : {};

  function changeValue(setting: SettingDefinition, value: string | boolean) {
    setChanges((previous) => ({
      ...previous,
      [setting.key]: setting.type === "string_list" && typeof value === "string"
        ? value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)
        : setting.type === "integer" && typeof value === "string" ? Number(value) : value,
    }));
    setNotice(null);
  }

  function discardChanges() {
    setChanges((previous) => Object.fromEntries(Object.entries(previous)
      .filter(([key]) => SETTING_REGISTRY.find((setting) => setting.key === key)?.sectionId !== sectionId)));
    setReason("");
  }

  async function save(action: "save" | "draft" | "publish") {
    if (!sectionId || busy) return;
    if (!reason.trim()) {
      setError("Enter a reason for this settings change.");
      return;
    }
    const requestValues = action === "publish" ? undefined : relevantChanges;
    if (action !== "publish" && Object.keys(requestValues ?? {}).length === 0) return;
    const publishDraftId = pendingDraft?.draftId;
    if (action === "publish" && !publishDraftId) {
      setError("There is no saved settings draft to publish.");
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId,
          action,
          values: requestValues,
          draftId: action === "publish" ? publishDraftId : undefined,
          reason: reason.trim(),
          idempotencyKey,
        }),
      });
      const result = await response.json() as { error?: string; status?: string; values?: Record<string, unknown> };
      if (!response.ok) throw new Error(result.error ?? "Unable to save settings.");
      if (action === "draft") {
        setPendingDraft({ sectionId, draftId: idempotencyKey, values: requestValues ?? {} });
        setNotice("Impact preview saved. Review the proposed values before publishing.");
      } else {
        setData((previous) => previous ? {
          ...previous,
          sections: {
            ...previous.sections,
            [sectionId]: { ...previous.sections[sectionId], values: result.values ?? {} },
          },
        } : previous);
        if (action === "publish") setPendingDraft(null);
        setChanges((previous) => Object.fromEntries(Object.entries(previous)
          .filter(([key]) => SETTING_REGISTRY.find((setting) => setting.key === key)?.sectionId !== sectionId)));
        setReason("");
        setNotice(action === "publish" ? "Settings changes published." : "Settings saved.");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to save settings.");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || (profile && !data && !error)) return <LoadingState label="Loading institution settings…" />;
  if (!profile) return <Card className="p-6"><h1 className="font-semibold text-ink">Sign in to manage settings</h1><p className="mt-2 text-sm text-muted">Institution settings require an authenticated workspace account.</p></Card>;
  if (error && !data) return <ErrorState message={error} onRetry={() => { setError(null); void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "Unable to load settings.")); }} />;

  return (
    <div className="pb-28">
      <PageHeader
        title="Settings"
        description="Institution configuration, access controls, modules, and locale preferences."
        primaryAction={<button type="button" onClick={() => lockWorkspace()} className="rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-surface-raised">Lock workspace</button>}
      />
      <div className="mb-5">
        <label htmlFor="settings-search" className="sr-only">Search settings</label>
        <input id="settings-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search settings" className="h-10 w-full max-w-xl rounded-md border border-line bg-surface px-3 text-sm text-ink" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
        <nav aria-label="Settings categories" className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible">
          {SETTINGS_CATEGORIES.map((category) => (
            <button key={category} type="button" aria-current={activeCategory === category ? "page" : undefined}
              onClick={() => { setActiveCategory(category); setNotice(null); setError(null); }}
              className={`shrink-0 rounded-md px-3 py-2 text-left text-sm lg:block lg:w-full ${activeCategory === category ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-raised hover:text-ink"}`}>
              {category}
            </button>
          ))}
        </nav>

        <section aria-labelledby="settings-section-heading" className="min-w-0 space-y-4">
          <Card className="p-5">
            <h2 id="settings-section-heading" className="text-lg font-semibold text-ink">{activeCategory}</h2>
            {CATEGORY_EXPLANATION[activeCategory] ? (
              <p className="mt-2 text-sm text-muted">{CATEGORY_EXPLANATION[activeCategory]}</p>
            ) : null}
            {CATEGORY_LINK[activeCategory] ? (
              <Link href={CATEGORY_LINK[activeCategory]!} className="mt-3 inline-flex text-sm font-medium text-accent hover:underline">
                  Open existing workspace
              </Link>
            ) : null}
          </Card>

          {sectionId ? settings.length ? settings.map((setting) => {
            const current = displayedValue(setting, sectionValues[setting.key] ?? setting.defaultValue);
            const value = Object.prototype.hasOwnProperty.call(changes, setting.key)
              ? changes[setting.key]
              : current;
            const fieldValue = setting.type === "string_list" && Array.isArray(value) ? value.join("\n") : String(value);
            const recommended = setting.defaultValue !== undefined && JSON.stringify(current) === JSON.stringify(setting.defaultValue);
            const disabled = setting.key === "profile.whiteLabelFooter" && !data?.capabilities.whiteLabelFooter;
            return (
              <Card key={setting.key} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <label htmlFor={setting.key} className="font-medium text-ink">{setting.label}</label>
                    <p className="mt-1 text-xs text-muted">{setting.sensitivity} · {setting.effect.replaceAll("_", " ")}</p>
                    {recommended ? <span className="mt-2 inline-flex rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">Recommended</span> : null}
                    {setting.key === "profile.whiteLabelFooter" && !data?.capabilities.whiteLabelFooter
                      ? <p className="mt-2 text-xs text-muted">Available with the white-label entitlement.</p> : null}
                  </div>
                  <div className="w-full max-w-md">
                    {setting.type === "boolean" ? (
                      <input id={setting.key} type="checkbox" checked={Boolean(value)} disabled={disabled}
                        onChange={(event) => changeValue(setting, event.target.checked)} className="h-4 w-4 accent-accent" />
                    ) : setting.type === "enum" ? (
                      <select id={setting.key} value={String(value)} onChange={(event) => changeValue(setting, event.target.value)}
                        className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink">
                        {setting.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : setting.type === "string_list" ? (
                      <textarea id={setting.key} value={fieldValue} onChange={(event) => changeValue(setting, event.target.value)}
                        disabled={disabled} rows={3} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink" />
                    ) : (
                      <input id={setting.key} type={setting.type === "email" ? "email" : setting.type === "url" ? "url" : setting.type === "integer" ? "number" : setting.type === "color" ? "color" : "text"}
                        min={setting.minimum} max={setting.maximum} value={fieldValue} disabled={disabled}
                        onChange={(event) => changeValue(setting, event.target.value)}
                        className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink" />
                    )}
                  </div>
                </div>
              </Card>
            );
          }) : <Card className="p-5 text-sm text-muted">No matching settings. Clear the search to view this section.</Card>
            : <Card className="p-5"><p className="text-sm text-muted">This section is not configured in the institution settings registry yet.</p></Card>}

          {pendingDraft && pendingDraft.sectionId === sectionId ? (
            <Card className="border border-accent/30 p-5">
              <h3 className="font-semibold text-ink">Review change preview</h3>
              <p className="mt-1 text-sm text-muted">The proposed change is saved as a draft and has not affected active settings.</p>
              <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-surface-raised p-3 text-xs text-ink">{JSON.stringify(pendingDraft.values, null, 2)}</pre>
              <button type="button" onClick={() => void save("publish")} disabled={busy || !reason.trim()}
                className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50">
                {busy ? "Publishing…" : "Publish reviewed changes"}
              </button>
            </Card>
          ) : null}

          {activeCategory === "Security & Access" ? (
            <Card className="p-5">
              <h3 className="font-semibold text-ink">Personal workspace session</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm text-muted">Session lifetime
                  <select value={sessionPolicy} onChange={(event) => void updateSessionPolicy(event.target.value as typeof sessionPolicy)}
                    className="mt-1 h-10 w-full rounded-md border border-line bg-surface px-3 text-ink">
                    {SESSION_POLICY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="text-sm text-muted">Workspace inactivity lock
                  <select value={lockTimeout} onChange={(event) => {
                    window.localStorage.setItem("veqweris-lock-timeout", event.target.value);
                    window.location.reload();
                  }} className="mt-1 h-10 w-full rounded-md border border-line bg-surface px-3 text-ink">
                    {LOCK_TIMEOUT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
            </Card>
          ) : null}

          {activeCategory === "Data, Locale & Compliance" ? (
            <Card className="p-5">
              <h3 className="font-semibold text-ink">Personal preferences</h3>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm text-muted">Language
                  <input value={preferences?.language ?? "en"} onChange={(event) => void savePreferences({ ...preferences, language: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border border-line bg-surface px-3 text-ink" />
                </label>
                <label className="text-sm text-muted">Personal timezone
                  <input value={preferences?.timezone ?? "UTC"} onChange={(event) => void savePreferences({ ...preferences, timezone: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border border-line bg-surface px-3 text-ink" />
                </label>
                <label className="text-sm text-muted">Personal date format
                  <input value={preferences?.dateFormat ?? "MM/DD/YYYY"} onChange={(event) => void savePreferences({ ...preferences, dateFormat: event.target.value })}
                    className="mt-1 h-10 w-full rounded-md border border-line bg-surface px-3 text-ink" />
                </label>
              </div>
            </Card>
          ) : null}

          {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</p> : null}
          {notice ? <p role="status" className="rounded-md border border-line bg-surface p-3 text-sm text-muted">{notice}</p> : null}
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <p className="shrink-0 text-sm font-medium text-ink">{Object.keys(relevantChanges).length ? `${Object.keys(relevantChanges).length} unsaved change(s)` : "No unsaved changes"}</p>
            <label htmlFor="settings-reason" className="sr-only">Reason for settings change</label>
            <input id="settings-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for change" maxLength={500}
              className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm text-ink" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={discardChanges} disabled={!Object.keys(relevantChanges).length || busy}
              className="rounded-md border border-line px-3 py-2 text-sm text-ink disabled:opacity-50">Discard</button>
            <button type="button" onClick={() => {
              const hasPreviewEffect = settings.some((setting) => Object.prototype.hasOwnProperty.call(relevantChanges, setting.key) && setting.effect === "requires_approval");
              void save(hasPreviewEffect ? "draft" : "save");
            }} disabled={!Object.keys(relevantChanges).length || busy || !reason.trim()}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50">
              {busy ? "Saving…" : settings.some((setting) => Object.prototype.hasOwnProperty.call(relevantChanges, setting.key) && setting.effect === "requires_approval") ? "Save preview" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
