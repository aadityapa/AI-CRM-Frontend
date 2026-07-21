import { describe, expect, it } from "vitest";
import {
  applyHoursAttendanceRule,
  attendanceFromHoursWorked,
  shouldDeriveAttendanceFromHours,
} from "./timesheetAttendance";

describe("attendanceFromHoursWorked", () => {
  it.each([
    [0, "Absent"],
    [1, "Absent"],
    [2, "Absent"],
    [3, "Absent"],
    [3.5, "Absent"],
    [3.9, "Absent"],
    [4, "Half_Day"],
    [7, "Half_Day"],
    [7.5, "Half_Day"],
    [7.9, "Half_Day"],
    [8, "Present"],
    [9, "Present"],
    [11, "Present"],
    [12, "Present"],
  ])("maps %s hours to %s", (hours, expected) => {
    expect(attendanceFromHoursWorked(hours)).toBe(expected);
  });

  it("uses inclusive lower thresholds", () => {
    expect(attendanceFromHoursWorked(3.9)).toBe("Absent");
    expect(attendanceFromHoursWorked(4.0)).toBe("Half_Day");
    expect(attendanceFromHoursWorked(7.9)).toBe("Half_Day");
    expect(attendanceFromHoursWorked(8.0)).toBe("Present");
  });

  it("does not cap hours above 8", () => {
    expect(attendanceFromHoursWorked(12)).toBe("Present");
  });
});

describe("shouldDeriveAttendanceFromHours", () => {
  it("applies only to working non-leave rows", () => {
    expect(
      shouldDeriveAttendanceFromHours({
        day_type: "Working",
        is_working: true,
        attendance_status: "Present",
      }),
    ).toBe(true);
    expect(
      shouldDeriveAttendanceFromHours({
        day_type: "Working",
        is_working: true,
        attendance_status: "Leave",
      }),
    ).toBe(false);
    expect(
      shouldDeriveAttendanceFromHours({
        day_type: "Week_Off",
        is_working: false,
        attendance_status: "Week_Off",
      }),
    ).toBe(false);
    expect(
      shouldDeriveAttendanceFromHours({
        day_type: "Holiday",
        is_working: false,
        attendance_status: "Holiday",
      }),
    ).toBe(false);
  });
});

describe("applyHoursAttendanceRule", () => {
  const base = {
    day_type: "Working",
    is_working: true,
    hours_worked: "0",
    attendance_status: "Present",
  };

  it("derives attendance for working rows", () => {
    expect(applyHoursAttendanceRule({ ...base, hours_worked: "3.9" }).attendance_status).toBe(
      "Absent",
    );
    expect(applyHoursAttendanceRule({ ...base, hours_worked: "4" }).attendance_status).toBe(
      "Half_Day",
    );
    expect(applyHoursAttendanceRule({ ...base, hours_worked: "8" }).attendance_status).toBe(
      "Present",
    );
  });

  it("preserves leave rows", () => {
    expect(
      applyHoursAttendanceRule({
        ...base,
        hours_worked: "0",
        attendance_status: "Leave",
      }).attendance_status,
    ).toBe("Leave");
  });

  it("preserves non-working rows", () => {
    expect(
      applyHoursAttendanceRule({
        day_type: "Week_Off",
        is_working: false,
        hours_worked: "9",
        attendance_status: "Week_Off",
      }).attendance_status,
    ).toBe("Week_Off");
    expect(
      applyHoursAttendanceRule({
        day_type: "Holiday",
        is_working: false,
        hours_worked: "9",
        attendance_status: "Holiday",
      }).attendance_status,
    ).toBe("Holiday");
  });
});
