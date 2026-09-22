import React from "react";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AcademicSetupPanel, AssessmentResultsPanel, AttendancePanel, TimetablePanel } from "../components/school/academic";

describe("school academic ui", () => {
  it("renders academic setup overview", () => {
    const html = renderToStaticMarkup(
      React.createElement(AcademicSetupPanel, {
        headline: "Academic foundation",
        metrics: [
          { label: "Academic year", value: 2, tone: "success" },
          { label: "Subjects", value: 6, tone: "warning" },
        ],
        items: [{ label: "Readiness", value: "3/5" }, { label: "Curricula", value: "2" }],
      }),
    );
    assert.match(html, /Academic foundation/);
    assert.match(html, /Readiness/);
  });

  it("renders assessment summaries and timetable conflicts", () => {
    const resultHtml = renderToStaticMarkup(
      React.createElement(AssessmentResultsPanel, {
        summary: { passRate: 75, average: 73.4, total: 4 },
        rows: [{ student: "A", subject: "Math", mark: 82, grade: "A", state: "Published" }],
      }),
    );
    const attendanceHtml = renderToStaticMarkup(
      React.createElement(AttendancePanel, {
        summary: { total: 4, present: 3, late: 1, absent: 0, attendanceRate: 75 },
        rows: [{ student: "A", state: "Present", period: "Period 1" }],
      }),
    );
    const timetableHtml = renderToStaticMarkup(
      React.createElement(TimetablePanel, {
        conflicts: [{ type: "teacher", message: "Teacher conflict at Mon|08:00" }],
        slots: [{ day: "Mon", period: "08:00", subject: "Math", className: "Form 1A", teacher: "T1" }],
      }),
    );
    assert.match(resultHtml, /Pass rate/);
    assert.match(attendanceHtml, /Daily register/);
    assert.match(timetableHtml, /Teacher conflict/);
  });
});
