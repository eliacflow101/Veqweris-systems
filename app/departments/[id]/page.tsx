"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeading } from "@/components/shared/section-heading";
import { useAuth } from "@/lib/auth-context";
import { useDepartments, useEmployees, useTasks } from "@/lib/firebase/data";
import { TaskStatusChart } from "@/components/shared/task-charts";
export default function DepartmentDetailPage() {
  const { id } = useParams<{ id: string }>(); const { profile } = useAuth(); const { data: departments } = useDepartments(profile?.institutionId); const { data: people } = useEmployees(profile?.institutionId); const { data: tasks } = useTasks(profile?.institutionId);
  const department = departments.find((item) => item.departmentId === id); const members = people.filter((p) => p.departmentId === id); const departmentTasks = tasks.filter((t) => t.departmentId === id);
  if (!department) return <p className="text-sm text-muted">Loading department…</p>;
  return <div><Link href="/departments" className="text-sm text-accent">← Departments</Link><SectionHeading eyebrow={department.departmentCode} title={department.name} description={department.description || "Department overview"} /><div className="grid gap-4 md:grid-cols-2"><Card className="p-5"><div className="flex justify-between"><p className="font-semibold text-ink">People</p><Badge>{members.length}</Badge></div><div className="mt-4 divide-y divide-line">{members.map((p) => <div className="flex justify-between py-3 text-sm" key={p.uid}><span className="text-ink">{p.fullName}</span><span className="text-muted">{p.role}</span></div>)}</div></Card><Card className="p-5"><div className="flex justify-between"><p className="font-semibold text-ink">Tasks</p><Badge>{departmentTasks.length}</Badge></div><div className="mt-4 divide-y divide-line">{departmentTasks.slice(0, 8).map((t) => <div className="flex justify-between py-3 text-sm" key={t.taskId}><span className="text-ink">{t.title}</span><span className="capitalize text-muted">{t.status.replace("_", " ")}</span></div>)}</div></Card></div><div className="mt-4 max-w-xl"><TaskStatusChart tasks={departmentTasks} title="Department task status" /></div></div>;
}
