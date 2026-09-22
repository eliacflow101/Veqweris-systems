"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { WorkspaceLock } from "@/components/security/workspace-lock";

export function Shell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const { loading, user, profileError, retryProfile, locked, unlockWorkspace, profile } = useAuth();
  if (pathname === "/login" || pathname === "/signup" || pathname === "/account-recovery") return <>{children}</>;
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-muted">Loading session…</div>;
  if (!user) return null;
  if (profileError) return <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas p-5 text-center"><p className="text-sm text-danger">{profileError}</p><button className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-raised" onClick={retryProfile}>Retry profile loading</button></div>;
  if (locked) return <WorkspaceLock email={profile?.email} onUnlock={(password) => unlockWorkspace(password)} />;
  return <div className="flex h-screen overflow-hidden bg-canvas"><Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />{mobileOpen && <button className="fixed inset-0 z-20 bg-black/30 lg:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)} /> }<div className="flex min-w-0 flex-1 flex-col"><Topbar onMenuClick={() => setMobileOpen(true)} /><main className="flex-1 overflow-y-auto"><div className="mx-auto min-h-full w-full max-w-[1440px] p-5 lg:p-8">{children}</div></main></div></div>;
}
