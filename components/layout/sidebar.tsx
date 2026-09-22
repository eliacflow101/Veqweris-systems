"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleUserRound, PanelLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { signOut } from "@/lib/firebase/auth";
import { isFeatureDisabled, navigationGroups } from "@/lib/navigation";

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { user, profile } = useAuth();

  const visibleGroups = useMemo(() => navigationGroups.filter((group) => group.items.some((item) => !item.disabled || item.visibility === "future")), [navigationGroups]);

  return (
    <aside className={`fixed inset-y-0 left-0 z-30 flex flex-col border-r border-line/80 bg-surface transition-all duration-200 lg:relative lg:translate-x-0 ${collapsed ? "w-[76px]" : "w-[260px]"} ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-[72px] items-center border-b border-line/80 px-4">
        <Link href="/" onClick={onClose} className="flex min-w-0 items-center gap-3">
          <img src="/branding/logo-icon.png" alt="Veqweris Systems" className="h-9 w-9 object-contain" />
          <span className={`truncate text-sm font-semibold text-ink ${collapsed ? "hidden" : "block"}`}>Veqweris Systems</span>
        </Link>
        <button onClick={() => setCollapsed((value) => !value)} className="ml-auto hidden text-muted hover:text-ink lg:block" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-5">
        {visibleGroups.map((group) => (
          <div key={group.label} className="mb-6">
            <p className={`mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted ${collapsed ? "hidden" : "block"}`}>{group.label}</p>
            {group.items.map(({ label, href, icon: Icon, disabled }) => {
              const isCurrent = pathname === href || (href !== "/" && pathname.startsWith(href));
              const isLocked = disabled || isFeatureDisabled(label);

              return isLocked ? (
                <span key={label} aria-disabled="true" title={`${label} (coming soon)`} className="mb-1 flex h-9 cursor-not-allowed items-center gap-3 rounded-md px-3 text-[13px] text-muted/50">
                  <Icon size={16} />
                  <span className={collapsed ? "hidden" : "block"}>{label}</span>
                </span>
              ) : (
                <Link
                  key={label}
                  href={href}
                  onClick={onClose}
                  title={collapsed ? label : undefined}
                  className={`mb-1 flex h-9 items-center gap-3 rounded-md px-3 text-[13px] ${isCurrent ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-raised hover:text-ink"}`}
                >
                  <Icon size={16} />
                  <span className={collapsed ? "hidden" : "block"}>{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-line/80 p-3">
        <div className="flex items-center gap-3 rounded-md bg-surface-raised p-2">
          <CircleUserRound size={30} className="shrink-0 text-muted" />
          <div className={collapsed ? "hidden" : "min-w-0"}>
            <p className="truncate text-sm font-medium text-ink">{profile?.fullName || user?.displayName || "Workspace member"}</p>
            <p className="truncate text-xs text-muted">{profile?.role || "Signed in user"}</p>
          </div>
          <button onClick={() => void signOut()} aria-label="Sign out" title="Sign out" className="ml-auto text-muted hover:text-ink"><PanelLeft size={15} /></button>
        </div>
      </div>
    </aside>
  );
}
