"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/shared/section-heading";
import { useAuth } from "@/lib/auth-context";
import { saveSchoolRecord, useAcademicYears, useCurricula, useSchoolClasses, useSchoolProfile, useSchoolSubjects } from "@/lib/firebase/data";
import { AcademicSetupPanel, SchoolQuickForm } from "@/components/school/academic";
import { calculateReadiness, gradeMark } from "@/lib/school";

export default function AcademicSetupPage() {
  const { profile } = useAuth();
  const institutionId = profile?.institutionId;
  const school = useSchoolProfile(institutionId);
  const years = useAcademicYears(institutionId);
  const classes = useSchoolClasses(institutionId);
  const subjects = useSchoolSubjects(institutionId);
  const curricula = useCurricula(institutionId);
  const [yearName, setYearName] = useState("");
  const [curriculumName, setCurriculumName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const readiness = useMemo(() => calculateReadiness({
    institutionConfigured: Boolean(institutionId),
    academicYearConfigured: years.data.some((year) => ["CONFIGURING", "ACTIVE"].includes(year.state)),
    curriculumConfigured: curricula.data.some((item) => item.subjectIds.length > 0 || item.status === "active"),
    classesConfigured: classes.data.length > 0,
    subjectsConfigured: subjects.data.length > 0,
    teachersAssigned: false,
    gradingConfigured: true,
    attendanceConfigured: true,
    feeScheduleConfigured: false,
    financeEnabled: false,
    departmentsConfigured: Boolean(school.data?.configuredDepartments.length),
  }), [classes.data.length, curricula.data, institutionId, school.data?.configuredDepartments.length, subjects.data.length, years.data]);

  async function saveYear() {
    if (!institutionId || !yearName.trim()) return;
    setSaving(true); setMessage(null);
    try {
      await saveSchoolRecord("academicYears", {
        institutionId,
        name: yearName.trim(),
        state: "DRAFT",
        startDate: "",
        endDate: "",
        termIds: [],
        levelIds: [],
        curriculumConfigured: false,
        gradingConfigured: false,
        attendanceConfigured: false,
        createdAt: null,
        updatedAt: null,
      }, "academicYearId");
      setYearName("");
      setMessage("Academic year saved as a draft.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Unable to save academic year.");
    } finally {
      setSaving(false);
    }
  }

  async function saveCurriculum() {
    if (!institutionId || !curriculumName.trim()) return;
    setSaving(true); setMessage(null);
    try {
      await saveSchoolRecord("curricula", {
        institutionId,
        academicYearId: years.data[0]?.academicYearId ?? "",
        name: curriculumName.trim(),
        subjectIds: subjects.data.map((subject) => subject.subjectId).slice(0, 3),
        status: "draft",
        createdAt: null,
        updatedAt: null,
      }, "curriculumId");
      setCurriculumName("");
      setMessage("Curriculum draft created.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Unable to save curriculum.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeading eyebrow="Academic setup" title="Academic planning and curriculum" description="Configure the school year, curriculum, class structure, and readiness checks before students are graded and tracked." />
      {message && <Card className="p-4 text-sm text-muted">{message}</Card>}
      <div className="grid gap-4 lg:grid-cols-2">
        <SchoolQuickForm label="Academic year" placeholder="2027 academic year" value={yearName} onChange={setYearName} buttonLabel="Save draft" onSubmit={() => void saveYear()} disabled={saving || !institutionId} />
        <SchoolQuickForm label="Curriculum" placeholder="Mathematics and sciences" value={curriculumName} onChange={setCurriculumName} buttonLabel="Create plan" onSubmit={() => void saveCurriculum()} disabled={saving || !institutionId} />
      </div>
      <AcademicSetupPanel
        headline={school.data?.name ?? "Academic foundation"}
        metrics={[
          { label: "Academic year", value: years.data.length, tone: years.data.length > 0 ? "success" : "warning" },
          { label: "Classes", value: classes.data.length, tone: classes.data.length > 0 ? "success" : "warning" },
          { label: "Subjects", value: subjects.data.length, tone: subjects.data.length > 0 ? "success" : "warning" },
        ]}
        items={[
          { label: "Readiness", value: `${readiness.completed}/${readiness.total}` },
          { label: "Curricula", value: `${curricula.data.length}` },
          { label: "School type", value: school.data?.schoolType ?? "Primary" },
        ]}
      />
      <Card className="p-5">
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted">Grading check</p>
        <p className="mt-2 text-sm text-muted">The grade engine validates mark bands before results are accepted.</p>
        <div className="mt-3 flex gap-2">
          <Badge>{gradeMark(76, [{ minMark: 0, maxMark: 49, grade: "F", pass: false }, { minMark: 50, maxMark: 100, grade: "A", points: 4, pass: true }]).grade}</Badge>
        </div>
      </Card>
    </div>
  );
}
