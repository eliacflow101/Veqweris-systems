"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Search, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { StatusIndicator } from "./status-indicator";
import { ThemeToggle } from "./theme-toggle";
import { useAuth } from "@/lib/auth-context";
import { getPageMeta, globalSearchPlaceholder, systemStatus } from "@/lib/navigation";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { profile } = useAuth();
  const pathname = usePathname();
  const pageMeta = getPageMeta(pathname);

  return (
    <header className="flex min-h-[72px] items-center justify-between gap-4 border-b border-line/80 bg-surface px-5 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button className="text-muted transition-colors hover:text-ink lg:hidden" aria-label="Open navigation" onClick={onMenuClick}>☰</button>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">{pageMeta.subtitle}</p>
          <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">{pageMeta.title}</h1>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden w-48 items-center md:flex">
          <Search size={15} className="-mr-8 ml-3 z-10 text-muted" />
          <Input aria-label="Search" placeholder={globalSearchPlaceholder} className="w-full pl-9" />
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-line bg-surface-raised px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted md:flex">
          <span className="h-2 w-2 rounded-full bg-success" />
          {systemStatus}
        </div>
        <StatusIndicator />
        <ThemeToggle />
        <button aria-label="Notifications" title="Notifications (coming soon)" className="relative rounded-md p-2 text-muted hover:bg-surface-raised hover:text-ink">
          <Bell size={17} />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
        </button>
        <Link href="/profile" aria-label="Open profile" title="Open profile" className="flex items-center gap-2 rounded-md p-1.5 text-muted hover:bg-surface-raised hover:text-ink">
          <UserRound size={18} />
          <span className="hidden max-w-28 truncate text-xs font-medium sm:block">{profile?.fullName || "Profile"}</span>
        </Link>
      </div>
    </header>
  );
}
