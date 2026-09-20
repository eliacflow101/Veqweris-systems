"use client";

import Link from "next/link";
import { Activity, Building2, CheckCircle2, ListTodo, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/shared/section-heading";
import { TaskStatusChart } from "@/components/shared/task-charts";
import { useAuth } from "@/lib/auth-context";
import { useDepartments, useEmployees, useTasks } from "@/lib/firebase/data";

export default function DashboardPage() {
  const { profile } = useAuth();
  const departments = useDepartments(profile?.institutionId);
  const employees = useEmployees(profile?.institutionId);
  const tasks = useTasks(profile?.institutionId);
  const visibleEmployees = profile?.role === "Manager" ? employees.data.filter((u) => u.departmentId === profile.departmentId) : employees.data;
  const visibleTasks = profile?.role === "Employee"
    ? tasks.data.filter((t) => t.assignedTo === profile.uid)
    : profile?.role === "Manager"
      ? tasks.data.filter((t) => t.departmentId === profile.departmentId)
      : tasks.data;
  const stats = [
    { label: "Departments", value: departments.data.filter((d) => d.status === "active").length, icon: Building2, href: "/departments" },
    { label: "People", value: visibleEmployees.filter((u) => u.status === "active").length, icon: Users, href: "/employees" },
    { label: "Open tasks", value: visibleTasks.filter((t) => t.status !== "done").length, icon: ListTodo, href: "/tasks" },
  ];

  return (
    <div className="py-2">
      <SectionHeading eyebrow={`Operations · ${profile?.role ?? "Workspace"}`} title={`Good to see you, ${profile?.fullName?.split(" ")[0] ?? "there"}`} description="A live view of the work and people available to your role." />
      <div className="grid gap-4 md:grid-cols-3">{stats.map(({ label, value, icon: Icon, href }) => <Link href={href} key={label}><Card className="p-5 transition-colors hover:bg-surface-raised"><div className="flex items-center justify-between"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-soft text-accent"><Icon size={17} /></span><Activity size={16} className="text-muted" /></div><p className="mt-7 text-xs font-medium uppercase tracking-[0.1em] text-muted">{label}</p><p className="mt-2 text-2xl font-semibold text-ink">{value}</p></Card></Link>)}</div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card className="p-5"><div className="flex items-center justify-between border-b border-line pb-4"><p className="text-sm font-semibold text-ink">Task flow</p><Badge>{visibleTasks.length} visible</Badge></div><div className="divide-y divide-line">{(["todo", "in_progress", "review", "done"] as const).map((status) => <div className="flex items-center justify-between py-3" key={status}><span className="text-sm capitalize text-ink">{status.replace("_", " ")}</span><span className="text-sm font-semibold text-muted">{visibleTasks.filter((t) => t.status === status).length}</span></div>)}</div></Card>
        <TaskStatusChart tasks={visibleTasks} />
      </div>
      <div className="mt-4"><Card className="p-5"><div className="flex items-center gap-2 border-b border-line pb-4"><CheckCircle2 size={17} className="text-success" /><p className="text-sm font-semibold text-ink">Workspace health</p></div><p className="mt-5 text-sm leading-6 text-muted">Data is scoped to your institution and filtered according to your role. Use the workspace links to manage operational records.</p></Card></div>
    </div>
  );
}
