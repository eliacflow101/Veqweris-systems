"use client";

import { useMemo, useState } from "react";
import { MapPin, Plus, Utensils } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/shared/section-heading";
import { useAuth } from "@/lib/auth-context";
import { savePlannerEvent, useDepartments, useEmployees, useInstitution, usePlannerEvents } from "@/lib/firebase/data";
import type { PlannerEvent } from "@/lib/firebase/models";

const quickActions = [{ label: "Need Lunch", icon: Utensils, handler: "maps-restaurants" }] as const;
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const asDate = (value: unknown) => value && typeof value === "object" && "toDate" in value ? (value as { toDate: () => Date }).toDate() : new Date(value as string);
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const monthDays = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

function mapsLunch(institutionLocation?: string) {
  const tab = window.open("about:blank", "_blank");
  const open = (location: string) => {
    const url = `https://www.google.com/maps/search/restaurants+near+${encodeURIComponent(location)}`;
    if (tab) { tab.location.href = url; tab.opener = null; } else window.open(url, "_blank", "noopener,noreferrer");
  };
  if (!navigator.geolocation) { open(institutionLocation || "my institution"); return; }
  navigator.geolocation.getCurrentPosition(
    (position) => open(`${position.coords.latitude},${position.coords.longitude}`),
    () => open(institutionLocation || "my institution"),
    { timeout: 5000 },
  );
}

export default function PlannerPage() {
  const { profile } = useAuth();
  const { data: events, loading } = usePlannerEvents(profile?.institutionId, profile?.uid, profile?.role);
  const { data: departments } = useDepartments(profile?.institutionId);
  const { data: people } = useEmployees(profile?.institutionId);
  const institution = useInstitution(profile?.institutionId);
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<"month" | "week">("month");
  const [selectedDay, setSelectedDay] = useState(() => dateKey(new Date()));
  const [department, setDepartment] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const visibleEvents = useMemo(() => events.filter((event) => (!department || event.departmentId === department) && (!mineOnly || event.createdBy === profile?.uid || event.attendees?.includes(profile?.uid ?? ""))), [events, department, mineOnly, profile?.uid]);
  const canCreate = profile?.role === "Owner" || profile?.role === "Admin" || profile?.role === "Manager";
  const days = useMemo(() => {
    const start = view === "week" ? new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - cursor.getDay()) : monthStart(cursor);
    const count = view === "week" ? 7 : monthDays(cursor) + start.getDay();
    return Array.from({ length: count }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [cursor, view]);
  const selectedEvents = visibleEvents.filter((event) => dateKey(asDate(event.startTime)) === selectedDay);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile) return;
    const form = new FormData(event.currentTarget);
    const selectedDepartment = profile.role === "Manager" ? profile.departmentId : String(form.get("departmentId") || "") || null;
    await savePlannerEvent({
      departmentId: selectedDepartment,
      title: String(form.get("title")),
      description: String(form.get("description") || ""),
      startTime: new Date(String(form.get("startTime"))),
      endTime: new Date(String(form.get("endTime"))),
      location: String(form.get("location") || ""),
      createdBy: profile.uid,
      attendees: form.getAll("attendees").map(String),
    }, profile.institutionId);
    setShowForm(false);
    window.location.reload();
  };
  return <div>
    <div className="flex items-start justify-between gap-4"><SectionHeading eyebrow="Workspace" title="Planner" description="Coordinate institution-wide and department events in one focused calendar." />{canCreate && <Button className="bg-accent text-white" onClick={() => setShowForm(!showForm)}><Plus size={15} /> New event</Button>}</div>
    <div className="mb-5 flex flex-wrap items-center gap-2">{quickActions.map(({ label, icon: Icon, handler }) => <Button key={handler} onClick={() => mapsLunch(institution?.location || institution?.country)}><Icon size={15} /> {label}</Button>)}</div>
    {showForm && <Card className="mb-5 p-5"><form onSubmit={(event) => void submit(event)} className="grid gap-3 md:grid-cols-2"><Input required name="title" placeholder="Event title" /><Input name="location" placeholder="Location (optional)" /><Input name="startTime" required type="datetime-local" /><Input name="endTime" required type="datetime-local" />{profile?.role !== "Manager" && <select name="departmentId" className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink"><option value="">Institution-wide</option>{departments.filter((item) => item.status === "active").map((item) => <option key={item.departmentId} value={item.departmentId}>{item.name}</option>)}</select>}{profile?.role === "Manager" && <p className="text-sm text-muted">This event will be scoped to your department.</p>}<Input name="description" placeholder="Description (optional)" /><select multiple name="attendees" className="min-h-24 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">{people.filter((person) => person.status === "active").map((person) => <option key={person.uid} value={person.uid}>{person.fullName}</option>)}</select><Button type="submit" className="bg-accent text-white md:col-span-2">Create event</Button></form></Card>}
    <div className="mb-5 flex flex-wrap gap-2"><select className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink" value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">All visible departments</option>{departments.map((item) => <option key={item.departmentId} value={item.departmentId}>{item.name}</option>)}</select><Button className={mineOnly ? "border-accent text-accent" : ""} onClick={() => setMineOnly((value) => !value)}>My events</Button><Button className={view === "month" ? "border-accent text-accent" : ""} onClick={() => setView("month")}>Month</Button><Button className={view === "week" ? "border-accent text-accent" : ""} onClick={() => setView("week")}>Week</Button><Button onClick={() => setCursor(new Date())}>Today</Button></div>
    <div className="mb-4 flex items-center justify-between"><Button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - (view === "month" ? 30 : 7)))}>Previous</Button><p className="font-semibold text-ink">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p><Button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + (view === "month" ? 30 : 7)))}>Next</Button></div>
    {loading ? <p className="text-sm text-muted">Loading events…</p> : <div className="grid gap-5 lg:grid-cols-[1fr_300px]"><Card className="overflow-hidden p-3"><div className="grid grid-cols-7 gap-1">{dayNames.map((day) => <p className="p-2 text-center text-[11px] font-semibold uppercase text-muted" key={day}>{day}</p>)}{days.map((day) => { const count = visibleEvents.filter((event) => dateKey(asDate(event.startTime)) === dateKey(day)).length; return <button className={`min-h-20 rounded-md border p-2 text-left transition-colors hover:border-accent/50 ${dateKey(day) === selectedDay ? "border-accent bg-accent-soft" : "border-line"} ${day.getMonth() !== cursor.getMonth() && view === "month" ? "opacity-40" : ""}`} key={dateKey(day)} onClick={() => setSelectedDay(dateKey(day))}><span className="text-sm font-semibold text-ink">{day.getDate()}</span>{count > 0 && <Badge className="mt-3 block w-fit">{count} event{count === 1 ? "" : "s"}</Badge>}</button>; })}</div></Card><Card className="p-5"><p className="text-sm font-semibold text-ink">{new Date(`${selectedDay}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>{selectedEvents.length === 0 ? <p className="mt-5 text-sm text-muted">No events scheduled.</p> : <div className="mt-4 space-y-3">{selectedEvents.map((event: PlannerEvent) => <div className="border-b border-line pb-3 last:border-0" key={event.eventId}><p className="font-medium text-ink">{event.title}</p><p className="mt-1 text-xs text-muted">{asDate(event.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – {asDate(event.endTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>{event.location && <p className="mt-1 flex items-center gap-1 text-xs text-muted"><MapPin size={12} />{event.location}</p>}<p className="mt-2 text-xs text-muted">{event.description}</p></div>)}</div>}</Card></div>}
  </div>;
}
