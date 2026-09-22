"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/shared/section-heading";
import { AttendancePanel } from "@/components/school/academic";
import { summarizeAttendance } from "@/lib/school";

const attendanceOptions = ["Present", "Late", "Absent", "Excused"] as const;

export default function AttendancePage() {
  const [rows, setRows] = useState<Array<{ student: string; state: "Present" | "Late" | "Absent" | "Excused"; period: string }>>([
    { student: "Amina Wambui", state: "Present", period: "Period 1" },
    { student: "James Njoroge", state: "Late", period: "Period 2" },
    { student: "Faith Otieno", state: "Absent", period: "Period 3" },
    { student: "Brian Kamau", state: "Excused", period: "Period 4" },
  ]);
  const [studentName, setStudentName] = useState("Mirriam Achieng");
  const [status, setStatus] = useState<(typeof attendanceOptions)[number]>("Present");

  const summary = useMemo(() => summarizeAttendance(rows.map((row) => row.state)), [rows]);

  function addEntry() {
    setRows((current) => [{ student: studentName || "New student", state: status, period: "Period 5" }, ...current].slice(0, 8));
    setStudentName("");
  }

  return (
    <div className="space-y-6">
      <SectionHeading eyebrow="Attendance" title="Register and daily attendance" description="Capture present, late, absent, or excused student attendance while preserving a clear daily summary." />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Mark attendance</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Input placeholder="Student name" value={studentName} onChange={(event) => setStudentName(event.target.value)} />
            <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink" value={status} onChange={(event) => setStatus(event.target.value as (typeof attendanceOptions)[number])}>
              {attendanceOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button className="bg-accent text-white" onClick={addEntry}>Save entry</Button>
            <Badge>{summary.attendanceRate}% attendance</Badge>
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted">Summary</p>
          <div className="mt-3 space-y-2 text-sm text-muted">
            <div className="flex justify-between rounded-md border border-line bg-surface-raised p-3"><span>Present</span><span className="font-medium text-ink">{summary.present}</span></div>
            <div className="flex justify-between rounded-md border border-line bg-surface-raised p-3"><span>Late</span><span className="font-medium text-ink">{summary.late}</span></div>
            <div className="flex justify-between rounded-md border border-line bg-surface-raised p-3"><span>Absent</span><span className="font-medium text-ink">{summary.absent}</span></div>
          </div>
        </Card>
      </div>
      <AttendancePanel summary={summary} rows={rows} />
    </div>
  );
}
