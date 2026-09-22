import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type SchoolMetric = { label: string; value: string | number; tone?: "default" | "success" | "warning" };

export function AcademicSetupPanel({ headline, metrics, items }: { headline: string; metrics: SchoolMetric[]; items: Array<{ label: string; value: string; detail?: string }> }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted">Academic setup</p>
          <h3 className="mt-2 text-xl font-semibold text-ink">{headline}</h3>
        </div>
        <Badge>{metrics.length} checks</Badge>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-md border border-line bg-surface-raised p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted">{metric.label}</p>
            <p className={`mt-2 text-xl font-semibold ${metric.tone === "success" ? "text-emerald-600" : metric.tone === "warning" ? "text-amber-600" : "text-ink"}`}>{metric.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-raised p-3 text-sm">
            <div>
              <div className="font-medium text-ink">{item.label}</div>
              {item.detail ? <div className="text-xs text-muted">{item.detail}</div> : null}
            </div>
            <span className="text-ink">{item.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function AssessmentResultsPanel({ summary, rows }: { summary: { passRate: number; average: number; total: number }; rows: Array<{ student: string; subject: string; mark: number; grade: string; state: string }> }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted">Assessment</p>
          <h3 className="mt-2 text-xl font-semibold text-ink">Results overview</h3>
        </div>
        <Badge>{summary.total} entries</Badge>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-line bg-surface-raised p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-muted">Pass rate</p><p className="mt-2 text-xl font-semibold text-ink">{summary.passRate}%</p></div>
        <div className="rounded-md border border-line bg-surface-raised p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-muted">Average</p><p className="mt-2 text-xl font-semibold text-ink">{summary.average}</p></div>
        <div className="rounded-md border border-line bg-surface-raised p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-muted">Review state</p><p className="mt-2 text-xl font-semibold text-ink">Published</p></div>
      </div>
      <div className="mt-5 space-y-2">
        {rows.map((row) => (
          <div key={`${row.student}-${row.subject}`} className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-raised p-3 text-sm">
            <div>
              <div className="font-medium text-ink">{row.student}</div>
              <div className="text-xs text-muted">{row.subject}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-ink">{row.mark}%</span>
              <Badge>{row.grade}</Badge>
              <span className="text-xs text-muted">{row.state}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function AttendancePanel({ summary, rows }: { summary: { total: number; present: number; late: number; absent: number; attendanceRate: number }; rows: Array<{ student: string; state: string; period: string }> }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted">Attendance</p>
          <h3 className="mt-2 text-xl font-semibold text-ink">Daily register</h3>
        </div>
        <Badge>{summary.attendanceRate}%</Badge>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-line bg-surface-raised p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-muted">Present</p><p className="mt-2 text-xl font-semibold text-ink">{summary.present}</p></div>
        <div className="rounded-md border border-line bg-surface-raised p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-muted">Late</p><p className="mt-2 text-xl font-semibold text-ink">{summary.late}</p></div>
        <div className="rounded-md border border-line bg-surface-raised p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-muted">Absent</p><p className="mt-2 text-xl font-semibold text-ink">{summary.absent}</p></div>
        <div className="rounded-md border border-line bg-surface-raised p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-muted">Total</p><p className="mt-2 text-xl font-semibold text-ink">{summary.total}</p></div>
      </div>
      <div className="mt-5 space-y-2">
        {rows.map((row) => (
          <div key={`${row.student}-${row.period}`} className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-raised p-3 text-sm">
            <div>
              <div className="font-medium text-ink">{row.student}</div>
              <div className="text-xs text-muted">{row.period}</div>
            </div>
            <Badge>{row.state}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function TimetablePanel({ conflicts, slots }: { conflicts: Array<{ type: string; message: string }>; slots: Array<{ day: string; period: string; subject: string; className: string; teacher: string }> }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted">Timetable</p>
          <h3 className="mt-2 text-xl font-semibold text-ink">Class schedule</h3>
        </div>
        <Badge>{conflicts.length === 0 ? "Clean" : `${conflicts.length} conflict(s)`}</Badge>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {slots.map((slot) => (
          <div key={`${slot.day}-${slot.period}-${slot.className}`} className="rounded-md border border-line bg-surface-raised p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-[0.12em] text-muted">{slot.day}</span>
              <span className="text-xs text-muted">{slot.period}</span>
            </div>
            <div className="mt-3 font-medium text-ink">{slot.subject}</div>
            <div className="mt-1 text-sm text-muted">{slot.className} · {slot.teacher}</div>
          </div>
        ))}
      </div>
      {conflicts.length > 0 ? <div className="mt-5 space-y-2">{conflicts.map((conflict, index) => <div key={`${conflict.type}-${index}`} className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{conflict.type}: {conflict.message}</div>)}</div> : <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">No timetable conflicts detected for the current schedule.</div>}
    </Card>
  );
}

export function SchoolQuickForm({ label, placeholder, value, onChange, buttonLabel, onSubmit, disabled = false }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; buttonLabel: string; onSubmit: () => void; disabled?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-surface-raised p-4">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</p>
      <div className="mt-3 flex gap-2">
        <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="flex-1" />
        <Button className="bg-accent text-white" disabled={disabled} onClick={onSubmit}>{buttonLabel}</Button>
      </div>
    </div>
  );
}
