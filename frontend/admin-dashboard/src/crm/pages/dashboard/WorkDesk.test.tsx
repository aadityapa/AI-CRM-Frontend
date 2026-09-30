/**
 * The work desk (28 Sep 2026): the Dashboard shows the server's tabs as tiles
 * that LINK to the page where the work is done (never a list on the Dashboard);
 * the My Tasks page opens the linked tab, lists its items, and a feedback item
 * opens the interviews pop-up in place.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ThemeProvider } from "../../../theme/ThemeProvider";

const crmGet = vi.fn();
vi.mock("../../api", async () => {
  const actual = await vi.importActual<any>("../../api");
  return { ...actual, crmGet: (...a: any[]) => crmGet(...a) };
});

import { MyTasksPage, WorkDesk } from "./WorkDesk";

const item = (key: string, extra: object = {}) => ({
  key, title: `Cand ${key}`, subtitle: "OPP-1 — Tester", chip: "Technical L1", tone: "warn",
  when: null, path: "requirements/1?tab=resumes", action: "Schedule Technical L1", profile_id: 7, ...extra,
});

const DESK = {
  as_of: "2026-09-28T10:00:00Z",
  tabs: [
    { key: "feedback", label: "Feedback due", hint: "over", count: 0, items: [], link: "my-tasks?tab=feedback" },
    { key: "schedule_internal", label: "L1 / L2 interviews", hint: "to book", count: 1, items: [item("a")],
      link: "my-tasks?tab=schedule_internal" },
    { key: "screening", label: "To screen", hint: "desk", count: 2, items: [], link: "screening-desk?task=screening" },
  ],
};

beforeEach(() => {
  crmGet.mockReset();
  window.history.replaceState(null, "", "/admin/?view=crm");
});

describe("WorkDesk (Dashboard)", () => {
  it("shows tiles that link to the task page and no item list", async () => {
    crmGet.mockResolvedValue({ data: DESK });
    render(<ThemeProvider><WorkDesk /></ThemeProvider>);
    const tile = await screen.findByRole("link", { name: /L1 \/ L2 interviews/ });
    expect(tile.getAttribute("href")).toContain("my-tasks");
    expect(screen.getByRole("link", { name: /To screen/ }).getAttribute("href")).toContain("screening-desk");
    expect(screen.queryByText("Cand a")).toBeNull();
  });
});

describe("MyTasksPage", () => {
  it("opens the linked tab and lists its items with their action", async () => {
    window.history.replaceState(null, "", "/admin/?view=crm&p=my-tasks&tab=schedule_internal");
    crmGet.mockResolvedValue({ data: DESK });
    render(<ThemeProvider><MyTasksPage /></ThemeProvider>);
    await waitFor(() => expect(screen.getByRole("tab", { name: /L1 \/ L2 interviews/ }).getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByText("Cand a")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Schedule Technical L1" }).getAttribute("href")).toContain("requirements");
  });

  it("opens the interviews pop-up for a feedback item instead of leaving the page", async () => {
    crmGet.mockImplementation((url: string) => url.startsWith("/api/dashboard/desk")
      ? Promise.resolve({ data: { ...DESK, tabs: [{ key: "feedback", label: "Feedback due", hint: "over", count: 1,
          items: [item("f", { chip: "Technical L1", action: "Record feedback" })] }] } })
      : Promise.resolve({ data: [] }));
    render(<ThemeProvider><MyTasksPage /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Record feedback/ }));
    expect(await screen.findByRole("dialog", { name: /Interviews — Cand f/ })).toBeTruthy();
  });

  it("a customer interview shows the Sales slots and books in place", async () => {
    const slots = { kind: "Customer_Interview", interviewer: "anoop", duration_minutes: 45, note: null,
      proposed_at: "2026-09-29T05:52:00Z",
      slots: [{ scheduled_at: "2026-09-29T10:19", label: "29 Sep 2026, 10:19 AM IST", meeting_link: "https://t/x" },
              { scheduled_at: "2026-09-29T07:20", label: "29 Sep 2026, 07:20 AM IST", meeting_link: null }] };
    crmGet.mockImplementation((url: string) => url.startsWith("/api/dashboard/desk")
      ? Promise.resolve({ data: { ...DESK, tabs: [{ key: "schedule_customer", label: "Customer interviews", hint: "book",
          count: 1, items: [item("c", { chip: "Customer L1", action: "Schedule Customer L1",
            round_kind: "Customer_Interview", customer_slots: slots })] }] } })
      : new Promise(() => {}));
    render(<ThemeProvider><MyTasksPage /></ThemeProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Sales slots \(2\)/ }));
    const dialog = await screen.findByRole("dialog", { name: /Customer L1 — slots offered by the customer/ });
    expect(dialog.textContent).toContain("29 Sep 2026, 07:20 AM IST");
    expect(dialog.textContent).toContain("Panel: anoop");
    expect(screen.getAllByRole("button", { name: /Schedule Customer L1/ }).length).toBeGreaterThan(0);
  });

  it("a Sales tab offers the moves in place and the approval shows the terms", async () => {
    window.history.replaceState(null, "", "/admin/?view=crm&p=my-tasks&tab=sales_decide");
    const decide = item("d", { chip: "Customer L2 – Passed", tone: "ok", path: "profiles/7", action: "Decide the next step",
      current_status: "L2_Feedback", allowed: ["Shortlisted", "L1_Feedback", "Customer_L2_Rejected", "Rejected"] });
    const approval = item("a", { chip: "Waiting 1 day", path: "profiles/8", action: "Review terms", profile_id: 8,
      current_status: "Customer_Approval", allowed: [],
      offer: { ctc: 1150000, rate_unit: "Yearly", rate_value: 1150000, joining_date: "2026-10-05" } });
    crmGet.mockResolvedValue({ data: { ...DESK, tabs: [
      { key: "sales_decide", label: "Customer decision", hint: "verdict in", count: 1, items: [decide] },
      { key: "sales_approval", label: "Approve terms", hint: "approve", count: 1, items: [approval] },
    ] } });
    render(<ThemeProvider><MyTasksPage /></ThemeProvider>);
    // Forward and reject moves; the backward move lives on the profile.
    expect(await screen.findByRole("button", { name: "Customer Shortlisted" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Customer L2 Interview Reject|Customer L2 Rejected/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Approve terms/ }));
    expect(await screen.findByRole("button", { name: /Approve/ })).toBeTruthy();
    expect(screen.getByText(/11\.50 L a year/)).toBeTruthy();
    expect(screen.getByText(/Onboarding 2026-10-05/)).toBeTruthy();
    // The decision pop-up switches Approve → Send back in place, no second dialog.
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    await screen.findByRole("dialog", { name: /Approve these terms/ });
    fireEvent.click(screen.getByRole("radio", { name: /Send back/ }));
    expect(await screen.findByRole("dialog", { name: /Send the terms back to Sales/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send back to Sales/ })).toBeTruthy();
  });

  it("HR gets the HR tabs: request the HR round in place, join a booked one", async () => {
    window.history.replaceState(null, "", "/admin/?view=crm&p=my-tasks&tab=hr_discussion");
    crmGet.mockResolvedValue({ data: { ...DESK, tabs: [
      { key: "hr_discussion", label: "HR discussion", hint: "talk terms", count: 1,
        items: [item("h", { chip: "HR Discussion", path: "profiles/9", action: "Request HR round", profile_id: 9 })] },
      { key: "hr_interviews", label: "HR interviews", hint: "booked", count: 1, info: true,
        items: [item("i", { chip: "HR Round", path: "profiles/10", action: "Open", profile_id: 10,
          meeting_link: "https://meet.example/x", interviewer: "Priya" })] },
      { key: "hr_joining", label: "Joining soon", hint: "next 30 days", count: 0, info: true, items: [] },
    ] } });
    render(<ThemeProvider><MyTasksPage /></ThemeProvider>);
    expect(await screen.findByRole("button", { name: /Request HR round/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /HR interviews/ }));
    const join = await screen.findByRole("link", { name: /Join/ });
    expect(join.getAttribute("href")).toBe("https://meet.example/x");
    expect(screen.getByText(/Panel: Priya/)).toBeTruthy();
  });
  it("every tab filters by search, customer, month and status — on the whole list", async () => {
    window.history.replaceState(null, "", "/admin/?view=crm&p=my-tasks&tab=sales_timesheets");
    const ts = (k: string, customer: string, month: string, chip: string, tone = "info") => item(k, {
      title: `Emp ${k}`, subtitle: `Project ${k}`, chip, tone, customer, month, project: `Project ${k}`,
      section: customer, path: `timesheets/${k}`, action: "Fill & submit", profile_id: null });
    crmGet.mockResolvedValue({ data: { ...DESK, tabs: [
      { key: "sales_timesheets", label: "Timesheets pending", hint: "fill", count: 3, items: [
        ts("1", "HARMAN", "2026-08", "To submit · month ended 29 d ago", "bad"),
        ts("2", "HARMAN", "2026-09", "To submit"),
        ts("3", "VISTEON", "2026-09", "With GM for approval"),
      ] },
    ] } });
    render(<ThemeProvider><MyTasksPage /></ThemeProvider>);
    await screen.findByText("Emp 1");
    expect(crmGet.mock.calls[0][0]).toBe("/api/dashboard/desk?full=true");

    fireEvent.change(screen.getByRole("combobox", { name: "Customer" }), { target: { value: "HARMAN" } });
    expect(screen.queryByText("Emp 3")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Month" }), { target: { value: "2026-09" } });
    expect(screen.queryByText("Emp 1")).toBeNull();
    expect(screen.getByText("Emp 2")).toBeTruthy();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    // The status drops the day count ("To submit · month ended …" is "To submit").
    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "To submit" } });
    expect(screen.getByText("Emp 1")).toBeTruthy();
    expect(screen.queryByText("Emp 3")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));
    fireEvent.change(screen.getByRole("textbox", { name: /Search this tab/ }), { target: { value: "visteon" } });
    expect(screen.getByText("Emp 3")).toBeTruthy();
    expect(screen.queryByText("Emp 2")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: /Search this tab/ }), { target: { value: "nobody" } });
    expect(screen.getByText(/Nothing matches these filters/)).toBeTruthy();
  });
});
