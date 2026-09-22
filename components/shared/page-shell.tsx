import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function PageHeader({
  title,
  description,
  breadcrumbs,
  primaryAction,
  secondaryActions,
}: {
  title: string;
  description?: string;
  breadcrumbs?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 space-y-2">
        {breadcrumbs ? <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted">{breadcrumbs}</div> : null}
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">{title}</h1>
          {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
        </div>
      </div>
      {(primaryAction || secondaryActions) && (
        <div className="flex flex-wrap items-center gap-2">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </header>
  );
}

export function SummaryMetrics({ items }: { items: Array<{ label: string; value: string | number; hint?: string }> }) {
  return (
    <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} className="p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{item.label}</p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <span className="text-2xl font-semibold text-ink">{item.value}</span>
            {item.hint ? <span className="text-xs text-muted">{item.hint}</span> : null}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function FilterToolbar({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div className="mb-5 rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
        {onReset ? (
          <Button type="button" onClick={onReset} className="h-9">
            Reset filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function LoadingState({ label = "Loading data…" }: { label?: string }) {
  return (
    <Card className="p-6">
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-1/5 rounded bg-surface-raised" />
        <div className="h-8 w-2/3 rounded bg-surface-raised" />
        <div className="h-4 w-3/4 rounded bg-surface-raised" />
      </div>
      <p className="mt-4 text-sm text-muted">{label}</p>
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Card className="p-8 text-center">
      <p className="text-lg font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{description}</p>
      {actionLabel && onAction ? (
        <Button type="button" onClick={onAction} className="mt-5">
          {actionLabel}
        </Button>
      ) : null}
    </Card>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
  details,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  details?: string;
}) {
  return (
    <Card className="border border-danger/30 bg-danger/5 p-6 text-left">
      <p className="text-base font-semibold text-ink">{title ?? "We could not load this view"}</p>
      <p className="mt-2 text-sm text-muted">{message}</p>
      {details ? <p className="mt-3 text-xs text-muted">{details}</p> : null}
      {onRetry ? (
        <Button type="button" onClick={onRetry} className="mt-4">
          Retry
        </Button>
      ) : null}
    </Card>
  );
}

export function DetailDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <aside className="h-full w-full max-w-lg overflow-y-auto border-l border-line bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-raised hover:text-ink">Close</button>
        </div>
        {children}
      </aside>
    </div>
  );
}
