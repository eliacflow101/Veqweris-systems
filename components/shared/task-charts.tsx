"use client";

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import type { Task, TaskPriority, TaskStatus } from "@/lib/firebase/models";

const statusLabels: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

const statusColors = ["#64748b", "#4f86c6", "#b48a4a", "#4d9278"];
const priorityOrder: TaskPriority[] = ["low", "medium", "high"];

function chartTooltip() {
  return {
    contentStyle: {
      background: "rgb(var(--color-surface))",
      border: "1px solid rgb(var(--color-line))",
      borderRadius: "var(--radius-md)",
      color: "rgb(var(--color-ink))",
      fontSize: 12,
    },
  };
}

export function TaskStatusChart({ tasks, title = "Task status distribution" }: { tasks: Task[]; title?: string }) {
  const data = (Object.keys(statusLabels) as TaskStatus[]).map((status) => ({
    name: statusLabels[status],
    value: tasks.filter((task) => task.status === status).length,
  }));

  return (
    <Card className="p-5">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <div className="mt-3 h-52">
        {tasks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">No tasks yet</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={3}>
                {data.map((entry, index) => <Cell key={entry.name} fill={statusColors[index]} />)}
              </Pie>
              <Tooltip {...chartTooltip()} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted">
        {data.map((entry, index) => (
          <span key={entry.name} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusColors[index] }} />
            {entry.name}: {entry.value}
          </span>
        ))}
      </div>
    </Card>
  );
}

export function TaskPriorityChart({ tasks }: { tasks: Task[] }) {
  const data = priorityOrder.map((priority) => ({
    name: priority[0].toUpperCase() + priority.slice(1),
    count: tasks.filter((task) => task.priority === priority).length,
  }));

  return (
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">Tasks by priority</p>
      <div className="mt-2 h-28">
        {tasks.length === 0 ? (
          <div className="flex h-full items-center text-sm text-muted">No tasks yet</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: "rgb(var(--color-muted))", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: "rgb(var(--color-muted))", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip {...chartTooltip()} cursor={{ fill: "rgb(var(--color-accent-soft))" }} />
              <Bar dataKey="count" fill="rgb(var(--color-accent))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
