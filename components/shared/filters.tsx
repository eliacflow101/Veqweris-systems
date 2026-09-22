import type { SelectHTMLAttributes, ReactNode } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

export function FilterBar({ children, onClear, active = false }: { children: ReactNode; onClear?: () => void; active?: boolean }) {
  return <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3">{children}{active && onClear && <button onClick={onClear} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"><X size={13} /> Clear filters</button>}</div>;
}
export function FilterSelect(props: SelectHTMLAttributes<HTMLSelectElement>) { const { className = "", ...rest } = props; return <select {...rest} className={`h-9 rounded-md border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 ${className}`} />; }
export function FilterSearch({ className = "", ...props }: React.ComponentProps<typeof Input>) { return <Input {...props} className={`min-w-48 ${className}`} />; }
