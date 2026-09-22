import type {
  AcademicYearState, AttendanceState, GradeRule, PlacementCapacity, PlacementCandidate, PlacementReviewState, ReadinessInput, ResultState, TimetableSlot,
} from "./models";

export const recommendedSchoolDepartments = [
  "Administration", "Academic Affairs", "Teaching & Learning", "Examinations", "Admissions", "Student Affairs",
  "Guidance & Counseling", "Finance", "HR", "ICT", "Library", "Procurement", "Stores", "Transport",
  "Boarding/Hostel", "Cafeteria", "Health/Medical", "Sports", "Clubs & Activities", "Maintenance",
  "Security", "Facilities", "Records", "Communications",
];

const academicYearTransitions: Record<AcademicYearState, AcademicYearState[]> = {
  DRAFT: ["CONFIGURING", "ARCHIVED"],
  CONFIGURING: ["ACTIVE", "DRAFT", "ARCHIVED"],
  ACTIVE: ["LOCKED", "CLOSED"],
  LOCKED: ["ACTIVE", "CLOSED"],
  CLOSED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransitionAcademicYear(from: AcademicYearState, to: AcademicYearState) {
  return academicYearTransitions[from].includes(to);
}

export function assessPlacement(candidate: PlacementCandidate, capacities: PlacementCapacity[]) {
  const capacity = capacities.find((item) => item.classId === candidate.classId && (item.streamId ?? null) === (candidate.streamId ?? null));
  if (!capacity) return { allowed: false, reason: "No configured capacity exists for this class or stream.", requiresConfirmation: true };
  if (capacity.enrolled >= capacity.capacity) return { allowed: false, reason: "Configured class or stream capacity has been reached.", requiresConfirmation: true };
  return { allowed: true, reason: "Capacity is available; administrator confirmation is still required.", requiresConfirmation: true };
}

export function canChangePlacementReview(from: PlacementReviewState, to: PlacementReviewState) {
  const transitions: Record<PlacementReviewState, PlacementReviewState[]> = {
    pending: ["approved", "rejected", "withdrawn"],
    approved: ["withdrawn"],
    rejected: ["pending"],
    withdrawn: [],
  };
  return transitions[from].includes(to);
}

export function gradeMark(mark: number, rules: GradeRule[]) {
  if (!Number.isFinite(mark) || mark < 0) throw new Error("Mark must be a non-negative number.");
  const match = rules.find((rule) => mark >= rule.minMark && mark <= rule.maxMark);
  if (!match) throw new Error("No grading rule covers this mark.");
  return match;
}

export function summarizeAttendance(states: AttendanceState[]) {
  const present = states.filter((state) => state === "Present").length;
  const late = states.filter((state) => state === "Late").length;
  const absent = states.filter((state) => state === "Absent").length;
  const excused = states.filter((state) => state === "Excused" || state === "Approved Leave").length;
  const rate = states.length === 0 ? 0 : ((present + late) / states.length) * 100;
  return { total: states.length, present, late, absent, excused, attendanceRate: Number(rate.toFixed(2)) };
}

export function detectTimetableConflicts(slots: TimetableSlot[]) {
  const conflicts: Array<{ type: "teacher" | "room" | "class"; timetableIds: string[]; message: string }> = [];
  const groups = new Map<string, TimetableSlot[]>();
  for (const slot of slots) {
    const key = `${slot.day}|${slot.period}`;
    groups.set(key, [...(groups.get(key) ?? []), slot]);
  }
  for (const [time, sameTime] of groups) {
    const check = (type: "teacher" | "room" | "class", values: Array<string | null | undefined>, message: string) => {
      const seen = new Map<string, string[]>();
      values.forEach((value, index) => {
        if (!value) return;
        seen.set(value, [...(seen.get(value) ?? []), sameTime[index].timetableId]);
      });
      for (const ids of seen.values()) if (ids.length > 1) conflicts.push({ type, timetableIds: ids, message: `${message} at ${time}.` });
    };
    check("teacher", sameTime.map((slot) => slot.teacherId), "Teacher conflict");
    check("room", sameTime.map((slot) => slot.roomId), "Room conflict");
    check("class", sameTime.map((slot) => `${slot.classId}|${slot.streamId ?? ""}`), "Class conflict");
  }
  return conflicts;
}

export function calculateReadiness(input: ReadinessInput) {
  const checks = [
    ["Institution configured", input.institutionConfigured],
    ["Academic year configured", input.academicYearConfigured],
    ["Curriculum configured", input.curriculumConfigured],
    ["Classes configured", input.classesConfigured],
    ["Subjects configured", input.subjectsConfigured],
    ["Teachers assigned", input.teachersAssigned],
    ["Grading configured", input.gradingConfigured],
    ["Attendance configured", input.attendanceConfigured],
    ["Departments configured", input.departmentsConfigured],
    ...(input.financeEnabled ? [["Fee schedule configured", input.feeScheduleConfigured] as const] : []),
  ] as const;
  const missing = checks.filter(([, ready]) => !ready).map(([label]) => label);
  return { ready: missing.length === 0, completed: checks.length - missing.length, total: checks.length, missing };
}

export function canChangeResult(state: ResultState, next: ResultState) {
  const transitions: Record<ResultState, ResultState[]> = {
    Entered: ["Submitted"],
    Submitted: ["Reviewed", "Entered"],
    Reviewed: ["Moderated", "Submitted"],
    Moderated: ["Approved", "Reviewed"],
    Approved: ["Published"],
    Published: [],
  };
  return transitions[state].includes(next);
}
