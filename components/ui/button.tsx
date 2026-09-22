import React from "react";
import type { ButtonHTMLAttributes } from "react";

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 text-[13px] font-semibold text-ink shadow-sm transition-colors hover:border-accent/40 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 ${className}`} {...props} />;
}

