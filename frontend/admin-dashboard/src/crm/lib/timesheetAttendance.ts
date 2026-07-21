/** Working-day attendance derived from hours worked (inclusive: 4→Half, 8→Present). */
export type AttendanceStatus =
  | "Present"
  | "Absent"
  | "Half_Day"
  | "Leave"
  | "Holiday"
  | "Week_Off";

export function attendanceFromHoursWorked(hours: number): AttendanceStatus {
  if (hours >= 8) return "Present";
  if (hours >= 4) return "Half_Day";
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
}>(row: T): T {
  if (!shouldDeriveAttendanceFromHours(row)) return row;
  const hours = Number(row.hours_worked || 0);
  if (Number.isNaN(hours)) return row;
  return { ...row, attendance_status: attendanceFromHoursWorked(hours) };
}
