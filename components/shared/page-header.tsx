import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, actions, breadcrumbs }: {
  eyebrow?: string; title: string; description?: string; actions?: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}) {
  return <div className="mb-7">
    {breadcrumbs && <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-2 text-xs text-muted">{breadcrumbs.map((item, index) => <span key={item.label} className="flex items-center gap-2">{index > 0 && <span aria-hidden="true">/</span>}{item.href ? <Link href={item.href} className="hover:text-ink">{item.label}</Link> : <span className="text-ink">{item.label}</span>}</span>)}</nav>}
    <div className="flex items-start justify-between gap-4"><div>{eyebrow && <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">{eyebrow}</p>}<h1 className="text-[1.65rem] font-semibold tracking-[-0.025em] text-ink">{title}</h1>{description && <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted">{description}</p>}</div>{actions && <div className="shrink-0">{actions}</div>}</div>
  </div>;
}
