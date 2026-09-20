"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { StatusIndicator } from "./status-indicator";
import { ThemeToggle } from "./theme-toggle";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  return <header className="flex min-h-[72px] items-center justify-between gap-4 border-b border-line/80 bg-surface px-5 lg:px-8"><div className="flex min-w-0 items-center gap-3"><button className="text-muted transition-colors hover:text-ink lg:hidden" aria-label="Open navigation" onClick={onMenuClick}>☰</button><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">Workspace</p><h1 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">Operations Overview</h1></div></div><div className="flex items-center gap-4"><div className="hidden w-48 items-center md:flex"><Search size={15} className="-mr-8 ml-3 z-10 text-muted" /><Input aria-label="Search" placeholder="Search workspace" className="w-full pl-9" /></div><StatusIndicator /><ThemeToggle /></div></header>;
}
