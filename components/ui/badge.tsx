import type { HTMLAttributes } from "react";

export function Badge({ className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`inline-flex items-center rounded-sm border border-line/80 bg-surface-raised px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted ${className}`} {...props} />;
}
