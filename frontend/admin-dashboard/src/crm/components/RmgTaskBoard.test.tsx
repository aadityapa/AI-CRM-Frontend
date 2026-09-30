/** RMG / GM task board (28 Sep 2026): a desk category filters the queue in
 *  place; any other category opens its list, each row a link to where the
 *  work is done. */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RmgTaskBoard, type TaskBoardData } from "./RmgTaskBoard";

const crmPost = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<any>("../api");
  return { ...actual, crmPost: (...a: any[]) => crmPost(...a) };
});

const item = (key: string, title: string, path: string, action: string, pid: number | null = null) =>
  ({ key, title, subtitle: "OPP-1", chip: null, tone: "warn" as const, when: null, path, action, profile_id: pid });
const data: TaskBoardData = { total: 3, as_of: "2026-09-28T10:00:00Z", categories: [
  { key: "results", label: "Results to review", hint: "h", icon: "sparkles", on_desk: true, count: 1, desk_ids: [7],
    items: [item("r", "Meera", "screening-desk?task=results&focus=7", "Review report", 7)] },
  { key: "booking", label: "L1 / L2 to book", hint: "h", icon: "calendar", on_desk: true, count: 0, desk_ids: [], items: [] },
  { key: "templates", label: "Template requests", hint: "TA needs a template", icon: "layout", on_desk: false, count: 2, desk_ids: [],
    items: [item("t1", "Embedded C", "template-requests", "Build template"), item("t2", "Tester", "template-requests", "Build template")] },
] };

describe("RmgTaskBoard", () => {
  it("filters the desk for a desk task and toggles it off again", () => {
    const pick = vi.fn();
    const { rerender } = render(<RmgTaskBoard data={data} loading={false} error="" onRetry={() => {}} activeTask={null} onPickDeskTask={pick} />);
    fireEvent.click(screen.getByRole("button", { name: /Results to review/ }));
    expect(pick).toHaveBeenLastCalledWith("results");
    rerender(<RmgTaskBoard data={data} loading={false} error="" onRetry={() => {}} activeTask="results" onPickDeskTask={pick} />);
    expect(screen.getByRole("button", { name: /Results to review/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /Results to review/ }));
    expect(pick).toHaveBeenLastCalledWith(null);
  });

  it("opens a page task's list with a link per row instead of filtering", () => {
    const pick = vi.fn();
    render(<RmgTaskBoard data={data} loading={false} error="" onRetry={() => {}} activeTask={null} onPickDeskTask={pick} />);
    fireEvent.click(screen.getByRole("button", { name: /Template requests/ }));
    expect(pick).not.toHaveBeenCalled();
    const links = screen.getAllByRole("link", { name: "Build template" });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toContain("p=template-requests");
    expect(screen.getByRole("region", { name: "Template requests" })).toBeInTheDocument();
  });

  it("lists a desk task's candidates who are past the desk, and marks a result reviewed there", async () => {
    /* 29 Sep 2026: "Results to review 1" opened an empty queue — the candidate
       had moved on to Sales. The board now lists them with their own link. */
    crmPost.mockResolvedValue({ data: { marked: 1 } });
    const retry = vi.fn();
    const past: TaskBoardData = { ...data, categories: [
      { key: "results", label: "Results to review", hint: "h", icon: "sparkles", on_desk: true, count: 1, desk_ids: [],
        items: [item("r", "Meera", "profiles/7?tab=interviews", "Review report", 7)] },
    ] };
    render(<RmgTaskBoard data={past} loading={false} error="" onRetry={retry} activeTask="results" onPickDeskTask={() => {}} />);
    expect(screen.getByText(/1 of “Results to review” is past the desk/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review report" }).getAttribute("href")).toContain("profiles%2F7");
    fireEvent.click(screen.getByRole("button", { name: /Mark reviewed/ }));
    await Promise.resolve(); await Promise.resolve();
    expect(crmPost).toHaveBeenCalledWith("/api/screening-desk/results-reviewed", { profile_id: 7 });
  });

  it("shows the GM's billing tiles, an info tile reading None at zero", () => {
    const gm: TaskBoardData = { total: 1, as_of: "2026-09-29T10:00:00Z", categories: [
      { key: "ts_approve", label: "Timesheets to approve", hint: "h", icon: "clock", on_desk: false, count: 1, desk_ids: [],
        always: true, items: [item("tsa:1", "Asha · Sep 2026", "timesheets/1", "Review & approve")] },
      { key: "invoices_issued", label: "Tax invoices issued", hint: "h", icon: "rupee", on_desk: false, count: 0, desk_ids: [],
        info: true, always: true, items: [] },
    ] };
    render(<RmgTaskBoard data={gm} loading={false} error="" onRetry={() => {}} activeTask="ts_approve" onPickDeskTask={() => {}} />);
    expect(screen.getByRole("link", { name: "Review & approve" }).getAttribute("href")).toContain("timesheets%2F1");
    expect(screen.getByRole("button", { name: /Tax invoices issued/ })).toHaveTextContent("None");
  });
});
