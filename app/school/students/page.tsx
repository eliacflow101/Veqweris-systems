"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/shared/section-heading";
import { EmptyState } from "@/components/shared/states";
import { useAuth } from "@/lib/auth-context";
import {
  saveSchoolRecord, useAcademicLevels, useAcademicYears, useEnrollments, useGuardians, usePlacementReviews,
  useSchoolClasses, useStudents, useStudentGuardianLinks,
} from "@/lib/firebase/data";
import { assessPlacement } from "@/lib/school";
import type { EnrollmentType, PlacementReview, StudentRecord } from "@/lib/school";

const enrollmentTypes: EnrollmentType[] = ["new registration", "admission", "transfer-in", "re-admission", "continuing", "application conversion", "bulk import"];

export default function StudentsPage() {
  const { profile } = useAuth();
  const institutionId = profile?.institutionId;
  const students = useStudents(institutionId);
  const guardians = useGuardians(institutionId);
  const links = useStudentGuardianLinks(institutionId);
  const years = useAcademicYears(institutionId);
  const levels = useAcademicLevels(institutionId);
  const classes = useSchoolClasses(institutionId);
  const enrollments = useEnrollments(institutionId);
  const reviews = usePlacementReviews(institutionId);
  const [student, setStudent] = useState({ fullName: "", dateOfBirth: "", gender: "", nationality: "" });
  const [guardian, setGuardian] = useState({ fullName: "", email: "", phone: "", relationship: "Parent", studentId: "" });
  const [enrollment, setEnrollment] = useState({ studentId: "", academicYearId: "", levelId: "", classId: "", type: "new registration" as EnrollmentType });
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const activeYear = years.data.find((year) => year.state === "ACTIVE") ?? years.data.find((year) => year.state === "CONFIGURING");
  const selectedClass = classes.data.find((item) => item.classId === enrollment.classId);
  const capacity = selectedClass ? { classId: selectedClass.classId, capacity: selectedClass.capacity, enrolled: enrollments.data.filter((item) => item.classId === selectedClass.classId && item.academicYearId === enrollment.academicYearId && item.status === "active").length } : null;
  const placement = useMemo(() => enrollment.studentId && enrollment.classId ? assessPlacement({ studentId: enrollment.studentId, levelId: enrollment.levelId, classId: enrollment.classId }, capacity ? [capacity] : []) : null, [enrollment, capacity]);

  async function saveStudent() {
    if (!institutionId || !student.fullName.trim()) return;
    setSaving(true); setMessage(null);
    try {
      const id = await saveSchoolRecord("students", { institutionId, ...student, institutionStudentId: `STU-${Date.now().toString().slice(-6)}`, guardianIds: [], status: "applicant", createdAt: null } as unknown as StudentRecord, "studentId");
      setEnrollment((current) => ({ ...current, studentId: id }));
      setGuardian((current) => ({ ...current, studentId: id }));
      setStudent({ fullName: "", dateOfBirth: "", gender: "", nationality: "" });
      setMessage("Student identity created. Complete enrollment and guardian details below.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create student."); }
    finally { setSaving(false); }
  }

  async function saveGuardian() {
    if (!institutionId || !guardian.fullName.trim() || !guardian.studentId) return;
    setSaving(true); setMessage(null);
    try {
      const guardianId = await saveSchoolRecord("guardians", { institutionId, fullName: guardian.fullName.trim(), email: guardian.email.trim(), phone: guardian.phone.trim(), createdAt: null }, "guardianId");
      await saveSchoolRecord("studentGuardianLinks", { institutionId, studentId: guardian.studentId, guardianId, relationship: guardian.relationship, consent: false, createdAt: null }, "linkId");
      const existingGuardianIds = links.data.filter((item) => item.studentId === guardian.studentId).map((item) => item.guardianId);
      await saveSchoolRecord("students", { institutionId, guardianIds: [...new Set([...existingGuardianIds, guardianId])] } as unknown as StudentRecord, "studentId", guardian.studentId);
      setMessage("Guardian saved and linked. Consent remains explicitly pending.");
      setGuardian({ fullName: "", email: "", phone: "", relationship: "Parent", studentId: guardian.studentId });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save guardian."); }
    finally { setSaving(false); }
  }

  async function submitEnrollment() {
    if (!institutionId || !enrollment.studentId || !enrollment.academicYearId || !enrollment.levelId || !enrollment.classId || !placement?.allowed) return;
    setSaving(true); setMessage(null);
    try {
      await saveSchoolRecord("academicEnrollments", { institutionId, studentId: enrollment.studentId, academicYearId: enrollment.academicYearId, enrollmentType: enrollment.type, levelId: enrollment.levelId, classId: enrollment.classId, status: "applied", createdAt: null }, "enrollmentId");
      await saveSchoolRecord("placementReviews", { institutionId, studentId: enrollment.studentId, academicYearId: enrollment.academicYearId, levelId: enrollment.levelId, classId: enrollment.classId, status: "pending", reviewNote: null, createdAt: null }, "placementReviewId");
      setMessage("Enrollment application submitted for placement review. No class placement was approved automatically.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to submit enrollment."); }
    finally { setSaving(false); }
  }

  async function reviewPlacement(review: PlacementReview, status: "approved" | "rejected") {
    if (!institutionId) return;
    setSaving(true);
    try {
      await saveSchoolRecord("placementReviews", { ...review, status, reviewedBy: profile?.uid ?? null, reviewNote: status === "approved" ? "Capacity and records reviewed." : "Placement requires correction.", reviewedAt: new Date().toISOString() }, "placementReviewId", review.placementReviewId);
      const enrollment = enrollments.data.find((item) => item.studentId === review.studentId && item.academicYearId === review.academicYearId && item.classId === review.classId && item.status === "applied");
      if (enrollment) await saveSchoolRecord("academicEnrollments", { ...enrollment, status: status === "approved" ? "active" : "withdrawn" }, "enrollmentId", enrollment.enrollmentId);
      if (status === "approved") {
        const record = students.data.find((item) => item.studentId === review.studentId);
        if (record) await saveSchoolRecord("students", { ...record, status: "active" }, "studentId", record.studentId);
      }
      setMessage(`Placement ${status}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update placement review."); }
    finally { setSaving(false); }
  }

  return <div className="space-y-6">
    <SectionHeading eyebrow="Student administration" title="Student identity and enrollment" description="Create a durable student identity, record guardians, submit yearly enrollment, and keep placement approval as an auditable review." />
    {message && <Card className="p-4 text-sm text-muted">{message}</Card>}
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5"><h3 className="font-semibold text-ink">Student identity</h3><div className="mt-4 grid gap-3 md:grid-cols-2">
        <Input className="md:col-span-2" placeholder="Full legal name" value={student.fullName} onChange={(e) => setStudent({ ...student, fullName: e.target.value })} />
        <Input type="date" aria-label="Date of birth" value={student.dateOfBirth} onChange={(e) => setStudent({ ...student, dateOfBirth: e.target.value })} />
        <Input placeholder="Gender (optional)" value={student.gender} onChange={(e) => setStudent({ ...student, gender: e.target.value })} />
        <Input placeholder="Nationality (optional)" value={student.nationality} onChange={(e) => setStudent({ ...student, nationality: e.target.value })} />
      </div><Button className="mt-4 bg-accent text-white" disabled={saving || !institutionId || !student.fullName.trim()} onClick={() => void saveStudent()}>Create identity</Button></Card>
      <Card className="p-5"><h3 className="font-semibold text-ink">Guardian relationship</h3><div className="mt-4 grid gap-3 md:grid-cols-2">
        <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm" value={guardian.studentId} onChange={(e) => setGuardian({ ...guardian, studentId: e.target.value })}><option value="">Select student</option>{students.data.map((item) => <option key={item.studentId} value={item.studentId}>{item.fullName}</option>)}</select>
        <Input placeholder="Guardian full name" value={guardian.fullName} onChange={(e) => setGuardian({ ...guardian, fullName: e.target.value })} /><Input placeholder="Email (optional)" value={guardian.email} onChange={(e) => setGuardian({ ...guardian, email: e.target.value })} /><Input placeholder="Phone (optional)" value={guardian.phone} onChange={(e) => setGuardian({ ...guardian, phone: e.target.value })} /><Input placeholder="Relationship" value={guardian.relationship} onChange={(e) => setGuardian({ ...guardian, relationship: e.target.value })} />
      </div><Button className="mt-4 bg-accent text-white" disabled={saving || !guardian.studentId || !guardian.fullName.trim()} onClick={() => void saveGuardian()}>Link guardian</Button><p className="mt-2 text-xs text-muted">Communication consent is never assumed.</p></Card>
    </div>
    <Card className="p-5"><h3 className="font-semibold text-ink">Yearly enrollment application</h3><div className="mt-4 grid gap-3 md:grid-cols-5">
      <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm" value={enrollment.studentId} onChange={(e) => setEnrollment({ ...enrollment, studentId: e.target.value })}><option value="">Student</option>{students.data.map((item) => <option key={item.studentId} value={item.studentId}>{item.fullName}</option>)}</select>
      <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm" value={enrollment.academicYearId} onChange={(e) => setEnrollment({ ...enrollment, academicYearId: e.target.value })}><option value="">Year {activeYear ? `(${activeYear.name})` : ""}</option>{years.data.map((item) => <option key={item.academicYearId} value={item.academicYearId}>{item.name}</option>)}</select>
      <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm" value={enrollment.levelId} onChange={(e) => setEnrollment({ ...enrollment, levelId: e.target.value, classId: "" })}><option value="">Level</option>{levels.data.map((item) => <option key={item.levelId} value={item.levelId}>{item.name}</option>)}</select>
      <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm" value={enrollment.classId} onChange={(e) => setEnrollment({ ...enrollment, classId: e.target.value })}><option value="">Class</option>{classes.data.filter((item) => !enrollment.levelId || item.levelId === enrollment.levelId).map((item) => <option key={item.classId} value={item.classId}>{item.name}</option>)}</select>
      <select className="h-9 rounded-md border border-line bg-surface px-3 text-sm" value={enrollment.type} onChange={(e) => setEnrollment({ ...enrollment, type: e.target.value as EnrollmentType })}>{enrollmentTypes.map((item) => <option key={item}>{item}</option>)}</select>
    </div><div className="mt-3 flex items-center gap-3 text-sm">{placement && <Badge>{placement.allowed ? "Capacity available" : placement.reason}</Badge>}<Button className="bg-accent text-white" disabled={saving || !placement?.allowed} onClick={() => void submitEnrollment()}>Submit for review</Button></div></Card>
    <Card className="p-5"><h3 className="font-semibold text-ink">Placement review queue</h3>{reviews.data.length ? <div className="mt-4 space-y-2">{reviews.data.map((review) => <div key={review.placementReviewId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-raised p-3 text-sm"><span className="text-ink">{students.data.find((item) => item.studentId === review.studentId)?.fullName ?? review.studentId} · {classes.data.find((item) => item.classId === review.classId)?.name ?? review.classId}</span><span className="flex items-center gap-2"><Badge>{review.status}</Badge>{review.status === "pending" && <><Button disabled={saving} onClick={() => void reviewPlacement(review, "approved")}>Approve</Button><Button disabled={saving} onClick={() => void reviewPlacement(review, "rejected")}>Reject</Button></>}</span></div>)}</div> : <EmptyState title="No placement reviews" description="Submitted yearly enrollments will appear here for an explicit administrator decision." />}</Card>
    <p className="text-xs text-muted">{links.data.length} guardian link(s) · {enrollments.data.length} enrollment application(s)</p>
  </div>;
}
