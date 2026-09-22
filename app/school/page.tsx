"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/states";
import { SectionHeading } from "@/components/shared/section-heading";
import { useAuth } from "@/lib/auth-context";
import { saveSchoolRecord, useAcademicYears, useSchoolClasses, useSchoolProfile, useSchoolSubjects, useStudents } from "@/lib/firebase/data";
import { calculateReadiness, recommendedSchoolDepartments } from "@/lib/school";
import type { AcademicYear, SchoolProfile } from "@/lib/school";

const schoolTypes = ["Primary", "Secondary", "High School", "Combined", "International", "Vocational/Technical", "College", "University", "Training", "Special Education", "Other"] as const;

export default function SchoolPage() {
  const { profile } = useAuth();
  const institutionId = profile?.institutionId;
  const school = useSchoolProfile(institutionId);
  const years = useAcademicYears(institutionId);
  const classes = useSchoolClasses(institutionId);
  const subjects = useSchoolSubjects(institutionId);
  const students = useStudents(institutionId);
  const [schoolType, setSchoolType] = useState<SchoolProfile["schoolType"]>("Primary");
  const [schoolName, setSchoolName] = useState("");
  const [yearName, setYearName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const readiness = calculateReadiness({
    institutionConfigured: Boolean(institutionId),
    academicYearConfigured: years.data.some((year) => ["CONFIGURING", "ACTIVE"].includes(year.state)),
    curriculumConfigured: Boolean(school.data?.configuredDepartments.length),
    classesConfigured: classes.data.length > 0,
    subjectsConfigured: subjects.data.length > 0,
    teachersAssigned: false,
    gradingConfigured: false,
    attendanceConfigured: false,
    feeScheduleConfigured: false,
    financeEnabled: false,
    departmentsConfigured: Boolean(school.data?.configuredDepartments.length),
  });

  async function saveProfile() {
    if (!institutionId || !schoolName.trim()) return;
    setSaving(true); setMessage(null);
    try {
      await saveSchoolRecord("schoolProfiles", {
        institutionId, schoolType, name: schoolName.trim(), recommendedDepartments: recommendedSchoolDepartments,
        configuredDepartments: [], createdAt: null, updatedAt: null,
      } as SchoolProfile & { name: string }, "institutionId", institutionId);
      setMessage("School profile saved. Department recommendations remain configurable.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Unable to save school profile."); }
    finally { setSaving(false); }
  }

  async function saveYear() {
    if (!institutionId || !yearName.trim()) return;
    setSaving(true); setMessage(null);
    try {
      const year: Omit<AcademicYear, "academicYearId"> & { academicYearId?: string } = {
        institutionId, name: yearName.trim(), state: "DRAFT", startDate: "", endDate: "", termIds: [], levelIds: [],
        curriculumConfigured: false, gradingConfigured: false, attendanceConfigured: false, createdAt: null, updatedAt: null,
      };
      await saveSchoolRecord("academicYears", year as AcademicYear, "academicYearId");
      setYearName(""); setMessage("Academic year draft created.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Unable to create academic year."); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <SectionHeading eyebrow="School vertical" title="Education workspace" description="Configure school identity and academic foundations before creating students, classes, or results." />
      {message && <Card className="p-4 text-sm text-muted">{message}</Card>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">School profile</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Input placeholder="School or institution name" value={schoolName} onChange={(event) => setSchoolName(event.target.value)} />
            <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink" value={schoolType} onChange={(event) => setSchoolType(event.target.value as SchoolProfile["schoolType"])}>{schoolTypes.map((type) => <option key={type}>{type}</option>)}</select>
          </div>
          <Button className="mt-4 bg-accent text-white" disabled={saving || !institutionId} onClick={() => void saveProfile()}>Save school profile</Button>
          {school.data && <p className="mt-3 text-sm text-muted">Configured type: {school.data.schoolType}. {school.data.recommendedDepartments.length} department recommendations available.</p>}
        </Card>
        <Card className="p-5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted">Readiness</p>
          <p className="mt-3 text-2xl font-semibold text-ink">{readiness.completed}/{readiness.total}</p>
          <Badge className="mt-2">{readiness.ready ? "Ready" : "Setup required"}</Badge>
          <p className="mt-3 text-xs text-muted">{readiness.missing.slice(0, 3).join(", ") || "All checks complete"}</p>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Academic years</h3>
          <div className="mt-4 flex gap-2"><Input placeholder="e.g. 2027 Academic Year" value={yearName} onChange={(event) => setYearName(event.target.value)} /><Button className="bg-accent text-white" disabled={saving} onClick={() => void saveYear()}>Add draft</Button></div>
          <div className="mt-4 space-y-2">{years.data.length ? years.data.map((year) => <div key={year.academicYearId} className="flex justify-between rounded-md border border-line bg-surface-raised p-3 text-sm"><span className="text-ink">{year.name}</span><Badge>{year.state}</Badge></div>) : <p className="text-sm text-muted">No academic years configured.</p>}</div>
        </Card>
        <Card className="p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Academic foundation</h3>
          <div className="mt-4 grid gap-2 text-sm text-muted">
            {[["Students", students.data.length], ["Classes", classes.data.length], ["Subjects", subjects.data.length], ["Curriculum", readiness.missing.includes("Curriculum configured") ? "Not configured" : "Configured"]].map(([label, value]) => <div key={String(label)} className="flex justify-between rounded-md border border-line bg-surface-raised p-3"><span>{label}</span><span className="font-medium text-ink">{value}</span></div>)}
          </div>
        </Card>
      </div>
      {!readiness.ready && <EmptyState title="Continue setup before daily operations" description={`The next safe setup actions are: ${readiness.missing.join(", ")}.`} />}
    </div>
  );
}
