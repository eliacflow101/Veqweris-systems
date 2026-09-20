export function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="mb-7"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">{eyebrow}</p><h2 className="text-[1.65rem] font-semibold tracking-[-0.025em] text-ink">{title}</h2><p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted">{description}</p></div>;
}
