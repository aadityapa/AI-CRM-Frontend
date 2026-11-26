import { describe, expect, it } from "vitest";
import { tasksToShow, weekDays } from "./EmployeeDashboard";
import { isEmployeeOnlyRoles } from "../../../lib/employeeLogin";
import type { Task } from "../../components/bench/BenchParts";

describe("employee dashboard (25 Nov 2026)", () => {
  it("reads the working week: logged, missed, today, ahead", () => {
    // Wednesday 25 Nov 2026
    const w = weekDays([{ date: "2026-11-23" }], "2026-11-25");
    expect(w.map((d) => d.date)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]);
    expect(w.map((d) => d.state)).toEqual(["done", "missed", "today", "ahead", "ahead"]);
    expect(weekDays([], "not a date")).toEqual([]);
  });

  it("lists open tasks, overdue first", () => {
    const t = (id: number, extra: Partial<Task>) => ({
      id, title: `T${id}`, priority: "Medium", status: "Open", overdue: false, due_date: null, ...extra,
    } as Task);
    const out = tasksToShow([
      t(1, { due_date: "2026-12-10" }), t(2, { status: "Done" }), t(3, { overdue: true, due_date: "2026-11-20" }),
      t(4, { due_date: "2026-11-30", priority: "High" }),
    ]);
    expect(out.map((x) => x.id)).toEqual([3, 4, 1]);
  });

  it("knows an employee-only login by the roles it holds", () => {
    expect(isEmployeeOnlyRoles(["Employee", "Interviewer"])).toBe(true);
    expect(isEmployeeOnlyRoles(["Sales", "Employee"], ["Employee"])).toBe(true);
    expect(isEmployeeOnlyRoles(["Employee", "TA"])).toBe(false);
    expect(isEmployeeOnlyRoles(["Interviewer"])).toBe(false);
    expect(isEmployeeOnlyRoles(null)).toBe(false);
  });
});
