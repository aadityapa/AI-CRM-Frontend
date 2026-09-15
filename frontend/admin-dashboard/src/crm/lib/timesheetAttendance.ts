/** Working-day attendance derived from hours worked (inclusive: 4→Half, 8→Present). */
export type AttendanceStatus =
  | "Present"
  | "Absent"
  | "Half_Day"
  | "Leave"
  | "Holiday"
  | "Week_Off";

/** Policy thresholds (11 Sep 2026): the branch/customer full- and half-day
 *  hours, defaulting to the historical 8 / 4 when not supplied. */
export type HourThresholds = { full?: number | null; half?: number | null };

export function attendanceFromHoursWorked(hours: number, thresholds?: HourThresholds | null): AttendanceStatus {
  const full = Number(thresholds?.full || 0) > 0 ? Number(thresholds!.full) : 8;
  const half = Number(thresholds?.half || 0) > 0 ? Number(thresholds!.half) : full / 2;
  if (hours >= full) return "Present";
  if (hours >= half) return "Half_Day";
  return "Absent";
}

export function shouldDeriveAttendanceFromHours(row: {
  day_type: string;
  is_working: boolean;
  attendance_status: string;
}): boolean {
  return row.day_type === "Working" && row.is_working && row.attendance_status !== "Leave";
}

export function applyHoursAttendanceRule<T extends {
  day_type: string;
  is_working: boolean;
  hours_worked: string;
  attendance_status: string;
}>(row: T, thresholds?: HourThresholds | null): T {
  if (!shouldDeriveAttendanceFromHours(row)) return row;
  const hours = Number(row.hours_worked || 0);
  if (Number.isNaN(hours)) return row;
  return { ...row, attendance_status: attendanceFromHoursWorked(hours, thresholds) };
}
