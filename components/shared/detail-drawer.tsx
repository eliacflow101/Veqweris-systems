"use client";
import type { ReactNode } from "react";
import { X } from "lucide-react";

export function DetailDrawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return <><button aria-label="Close details" className="fixed inset-0 z-40 bg-black/30" onClick={onClose} /><aside role="dialog" aria-modal="true" aria-label={title} className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-float"><header className="flex items-center justify-between border-b border-line px-5 py-4"><h2 className="font-semibold text-ink">{title}</h2><button aria-label="Close details" onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button></header><div className="flex-1 overflow-y-auto p-5">{children}</div></aside></>;
}
