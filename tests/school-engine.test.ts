import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessPlacement, calculateReadiness, canChangePlacementReview, canChangeResult, detectTimetableConflicts, gradeMark, summarizeAttendance } from "../lib/school";

describe("school vertical core extension", () => {
  it("requires confirmation and never auto-places a student", () => {
    const result = assessPlacement({ studentId: "student-1", levelId: "level-1", classId: "class-1" }, [{ classId: "class-1", capacity: 30, enrolled: 10 }]);
    assert.equal(result.allowed, true);
    assert.equal(result.requiresConfirmation, true);
  });

  it("grades through configurable rules", () => {
    assert.equal(gradeMark(76, [{ minMark: 0, maxMark: 49, grade: "F", pass: false }, { minMark: 50, maxMark: 100, grade: "A", points: 4, pass: true }]).grade, "A");
  });

  it("summarizes attendance deterministically", () => {
    assert.deepEqual(summarizeAttendance(["Present", "Late", "Absent", "Excused"]), { total: 4, present: 1, late: 1, absent: 1, excused: 1, attendanceRate: 50 });
  });

  it("detects teacher, room and class conflicts", () => {
    const slots = [
      { timetableId: "a", institutionId: "i", day: "Mon", period: "1", classId: "c1", teacherId: "t1", roomId: "r1", subjectId: "s1" },
      { timetableId: "b", institutionId: "i", day: "Mon", period: "1", classId: "c2", teacherId: "t1", roomId: "r2", subjectId: "s2" },
    ];
    assert.equal(detectTimetableConflicts(slots).some((item) => item.type === "teacher"), true);
  });

  it("reports missing readiness rather than fabricating setup", () => {
    const readiness = calculateReadiness({
      institutionConfigured: true, academicYearConfigured: false, curriculumConfigured: false, classesConfigured: false,
      subjectsConfigured: false, teachersAssigned: false, gradingConfigured: false, attendanceConfigured: false,
      feeScheduleConfigured: false, financeEnabled: false, departmentsConfigured: true,
    });
    assert.equal(readiness.ready, false);
    assert.ok(readiness.missing.includes("Academic year configured"));
  });

  it("prevents silent changes after publication", () => {
    assert.equal(canChangeResult("Approved", "Published"), true);
    assert.equal(canChangeResult("Published", "Entered"), false);
  });

  it("keeps placement approval as an explicit review transition", () => {
    assert.equal(canChangePlacementReview("pending", "approved"), true);
    assert.equal(canChangePlacementReview("approved", "rejected"), false);
  });
});
