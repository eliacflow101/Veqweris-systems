export type SchoolType = "Primary" | "Secondary" | "High School" | "Combined" | "International" | "Vocational/Technical" | "College" | "University" | "Training" | "Special Education" | "Other";
export type AcademicYearState = "DRAFT" | "CONFIGURING" | "ACTIVE" | "LOCKED" | "CLOSED" | "ARCHIVED";
export type EnrollmentType = "new registration" | "admission" | "transfer-in" | "re-admission" | "continuing" | "application conversion" | "bulk import";
export type AttendanceState = "Present" | "Absent" | "Late" | "Excused" | "Approved Leave";
export type ResultState = "Entered" | "Submitted" | "Reviewed" | "Moderated" | "Approved" | "Published";

export interface SchoolProfile {
  institutionId: string;
  name?: string;
  schoolType: SchoolType;
  recommendedDepartments: string[];
  configuredDepartments: string[];
  baseCurrency?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface AcademicYear {
  academicYearId: string;
  institutionId: string;
  name: string;
  state: AcademicYearState;
  startDate: string;
  endDate: string;
  termIds: string[];
  levelIds: string[];
  curriculumConfigured: boolean;
  gradingConfigured: boolean;
  attendanceConfigured: boolean;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface AcademicEnrollment {
  enrollmentId: string;
  institutionId: string;
  studentId: string;
  academicYearId: string;
  enrollmentType: EnrollmentType;
  levelId: string;
  classId?: string | null;
  streamId?: string | null;
  status: "applied" | "active" | "completed" | "withdrawn";
  admittedAt?: unknown;
  createdAt: unknown;
}

export interface StudentRecord {
  studentId: string;
  institutionId: string;
  institutionStudentId: string;
  fullName: string;
  dateOfBirth?: string | null;
  gender?: string | null;
  nationality?: string | null;
  guardianIds: string[];
  status: "applicant" | "active" | "inactive" | "graduated" | "transferred";
  createdAt: unknown;
}

export interface PlacementCandidate {
  studentId: string;
  levelId: string;
  classId: string;
  streamId?: string | null;
  boardingOrDay?: "boarding" | "day";
  houseId?: string | null;
}

export interface PlacementCapacity {
  classId: string;
  streamId?: string | null;
  capacity: number;
  enrolled: number;
}

export interface GradeRule {
  minMark: number;
  maxMark: number;
  grade: string;
  points?: number;
  description?: string;
  pass: boolean;
}

export interface TimetableSlot {
  timetableId: string;
  institutionId: string;
  day: string;
  period: string;
  classId: string;
  streamId?: string | null;
  teacherId: string;
  roomId?: string | null;
  subjectId: string;
}

export interface ReadinessInput {
  institutionConfigured: boolean;
  academicYearConfigured: boolean;
  curriculumConfigured: boolean;
  classesConfigured: boolean;
  subjectsConfigured: boolean;
  teachersAssigned: boolean;
  gradingConfigured: boolean;
  attendanceConfigured: boolean;
  feeScheduleConfigured: boolean;
  financeEnabled: boolean;
  departmentsConfigured: boolean;
}

export interface AcademicLevelRecord { levelId: string; institutionId: string; name: string; order: number; createdAt: unknown; }
export interface SchoolClassRecord { classId: string; institutionId: string; academicYearId: string; name: string; levelId: string; capacity: number; createdAt: unknown; }
export interface StreamRecord { streamId: string; institutionId: string; classId: string; name: string; capacity: number; createdAt: unknown; }
export interface SubjectRecord { subjectId: string; institutionId: string; code: string; name: string; departmentId?: string | null; createdAt: unknown; }
export interface CurriculumRecord { curriculumId: string; institutionId: string; academicYearId: string; name: string; subjectIds: string[]; status: "draft" | "active"; createdAt: unknown; updatedAt: unknown; }
export interface GuardianRecord { guardianId: string; institutionId: string; fullName: string; email?: string; phone?: string; createdAt: unknown; }
export interface StudentGuardianLink { linkId: string; institutionId: string; studentId: string; guardianId: string; relationship: string; communicationPreference?: string; consent?: boolean; createdAt: unknown; }

export type PlacementReviewState = "pending" | "approved" | "rejected" | "withdrawn";

export interface PlacementReview {
  placementReviewId: string;
  institutionId: string;
  studentId: string;
  academicYearId: string;
  levelId: string;
  classId: string;
  streamId?: string | null;
  status: PlacementReviewState;
  reviewedBy?: string | null;
  reviewNote?: string | null;
  reviewedAt?: unknown;
  createdAt: unknown;
}
