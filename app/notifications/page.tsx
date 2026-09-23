"use client";
import { useEffect, useMemo, useState } from "react";
import { Bell, Check, Filter } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import type { Notification } from "@/lib/notifications";
export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [origin, setOrigin] = useState("");
  useEffect(() => { void fetch(`/api/notifications${origin ? `?origin=${origin}` : ""}`).then((r) => r.json()).then((data) => setItems(data.notifications ?? [])); }, [origin]);
  const unread = useMemo(() => items.filter((item) => !item.read).length, [items]);
  return <div><PageHeader title="Notifications" description={`${unread} unread notification${unread === 1 ? "" : "s"}`} /><div className="mb-4 flex items-center gap-2"><Filter size={16} /><select value={origin} onChange={(e) => setOrigin(e.target.value)} className="rounded border border-line bg-surface px-3 py-2 text-sm"><option value="">All modules</option>{["task","approval","payment","planner","inventory","security","workflow","document","admission","academic","operational"].map((value) => <option key={value} value={value}>{value}</option>)}</select></div><div className="space-y-2">{items.map((item) => <article key={item.notificationId} className={`rounded-lg border border-line p-4 ${item.read ? "opacity-70" : "bg-accent-soft/30"}`}><div className="flex gap-3"><Bell size={18} className="mt-1 text-accent" /><div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><h2 className="font-semibold text-ink">{item.title}</h2>{item.important && <span className="text-xs text-warning">Important</span>}</div><p className="mt-1 text-sm text-muted">{item.body}</p><p className="mt-2 text-xs text-muted">{item.origin} · {new Date(item.createdAt).toLocaleString()}</p></div><button aria-label="Mark as read" onClick={() => void fetch("/api/notifications", { method: "POST", body: JSON.stringify({ action: "read", notificationId: item.notificationId }) }).then(() => setItems((current) => current.map((value) => value.notificationId === item.notificationId ? { ...value, read: true } : value)))}><Check size={16} /></button></div></article>)}</div></div>;
}
