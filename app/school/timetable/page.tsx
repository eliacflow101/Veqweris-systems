"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/components/shared/section-heading";
import { TimetablePanel } from "@/components/school/academic";
import { detectTimetableConflicts } from "@/lib/school";

const slots = [
  { day: "Mon", period: "08:00", subject: "Mathematics", className: "Form 1A", teacher: "Ms. Wanjiku" },
  { day: "Mon", period: "09:00", subject: "Science", className: "Form 1A", teacher: "Mr. Chege" },
  { day: "Tue", period: "08:00", subject: "English", className: "Form 1A", teacher: "Mrs. Akinyi" },
  { day: "Tue", period: "09:00", subject: "Computer", className: "Form 1B", teacher: "Mr. Chege" },
];

export default function TimetablePage() {
  const conflicts = useMemo(() => detectTimetableConflicts([
    { timetableId: "slot-1", institutionId: "school", day: "Mon", period: "08:00", classId: "form-1a", teacherId: "teacher-1", roomId: "room-7", subjectId: "math" },
    { timetableId: "slot-2", institutionId: "school", day: "Mon", period: "09:00", classId: "form-1a", teacherId: "teacher-2", roomId: "room-3", subjectId: "science" },
    { timetableId: "slot-3", institutionId: "school", day: "Tue", period: "08:00", classId: "form-1a", teacherId: "teacher-3", roomId: "room-2", subjectId: "english" },
    { timetableId: "slot-4", institutionId: "school", day: "Tue", period: "08:00", classId: "form-1b", teacherId: "teacher-2", roomId: "room-5", subjectId: "computer" },
  ]), []);

  return (
    <div className="space-y-6">
      <SectionHeading eyebrow="Timetable" title="Class timetable" description="Review subject allocation, teacher occupancy, and room usage before publishing a timetable." />
      <TimetablePanel conflicts={conflicts.map((conflict) => ({ type: conflict.type, message: conflict.message }))} slots={slots} />
      <Card className="p-4 text-sm text-muted">The timetable engine checks teacher, room and class clashes at the same period. Conflicts are flagged for review before publishing.</Card>
    </div>
  );
}
