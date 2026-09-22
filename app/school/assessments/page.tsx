"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/shared/section-heading";
import { useAuth } from "@/lib/auth-context";
import { useSchoolClasses, useSchoolSubjects, useStudents } from "@/lib/firebase/data";
import { AssessmentResultsPanel } from "@/components/school/academic";
import { canChangeResult, gradeMark } from "@/lib/school";

const gradingRules = [
  { minMark: 0, maxMark: 49, grade: "F", pass: false },
  { minMark: 50, maxMark: 64, grade: "C", pass: true },
  { minMark: 65, maxMark: 79, grade: "B", pass: true },
  { minMark: 80, maxMark: 100, grade: "A", pass: true },
];

export default function AssessmentResultsPage() {
  const { profile } = useAuth();
  const institutionId = profile?.institutionId;
  const students = useStudents(institutionId);
  const subjects = useSchoolSubjects(institutionId);
  const classes = useSchoolClasses(institutionId);
  const [studentId, setStudentId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [mark, setMark] = useState("72");
  const [state, setState] = useState("Submitted");
  const [results, setResults] = useState<Array<{ student: string; subject: string; mark: number; grade: string; state: string }>>([
    { student: "Amina Wambui", subject: "Mathematics", mark: 82, grade: "A", state: "Published" },
    { student: "James Njoroge", subject: "English", mark: 71, grade: "B", state: "Reviewed" },
    { student: "Faith Otieno", subject: "Biology", mark: 58, grade: "C", state: "Submitted" },
  ]);

  const summary = useMemo(() => {
    const average = results.length ? (results.reduce((total, item) => total + item.mark, 0) / results.length).toFixed(1) : "0.0";
    const passRate = results.length ? Math.round((results.filter((item) => item.mark >= 50).length / results.length) * 100) : 0;
    return { total: results.length, average: Number(average), passRate };
  }, [results]);

  function addResult() {
    const selectedStudent = students.data.find((item) => item.studentId === studentId)?.fullName ?? "New student";
    const selectedSubject = subjects.data.find((item) => item.subjectId === subjectId)?.name ?? "General";
    const nextMark = Number(mark) || 0;
    const awarded = gradeMark(Math.min(Math.max(nextMark, 0), 100), gradingRules);
    const nextResult = { student: selectedStudent, subject: selectedSubject, mark: nextMark, grade: awarded.grade, state };
    setResults((current) => [nextResult, ...current].slice(0, 6));
    setMark("72");
    setState("Submitted");
  }

  return (
    <div className="space-y-6">
      <SectionHeading eyebrow="Assessment & results" title="Student assessment workflow" description="Record assessment marks, keep result transitions auditable, and publish only when the final state is approved." />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <Card className="p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Result entry</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink" value={studentId} onChange={(event) => setStudentId(event.target.value)}>
              <option value="">Select student</option>
              {students.data.map((student) => <option key={student.studentId} value={student.studentId}>{student.fullName}</option>)}
            </select>
            <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
              <option value="">Select subject</option>
              {subjects.data.map((subject) => <option key={subject.subjectId} value={subject.subjectId}>{subject.name}</option>)}
            </select>
            <Input type="number" min={0} max={100} value={mark} onChange={(event) => setMark(event.target.value)} placeholder="Mark" />
            <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink" value={state} onChange={(event) => setState(event.target.value)}>
              {(["Entered", "Submitted", "Reviewed", "Moderated", "Approved", "Published"] as const).map((status) => <option key={status}>{status}</option>)}
            </select>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button className="bg-accent text-white" onClick={addResult}>Save result</Button>
            <Badge>{canChangeResult("Submitted", "Reviewed") ? "Transition allowed" : "Blocked"}</Badge>
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted">State flow</p>
          <div className="mt-3 space-y-2 text-sm text-muted">
            {(["Entered", "Submitted", "Reviewed", "Moderated", "Approved", "Published"] as const).map((status) => (
              <div key={status} className="flex justify-between rounded-md border border-line bg-surface-raised p-3">
                <span>{status}</span>
                <span className="font-medium text-ink">{status === state ? "Current" : "Ready"}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <AssessmentResultsPanel summary={summary} rows={results} />
      {classes.data.length === 0 && <Card className="p-4 text-sm text-muted">No class roster is configured yet. Results will route once the academic setup is complete.</Card>}
    </div>
  );
}
