/** Approval must follow review, not precede it.
 *
 * The rule these tests protect: a reviewer cannot approve or reject a timesheet
 * from a summary row. The only route to those buttons is opening the timesheet
 * and scrolling past every day of the period — so the buttons live at the foot
 * of the detail page, under the daily grid and above Invoice Details.
 *
 * Two things could quietly undo that: someone re-adding Approve/Reject to the
 * list for convenience, or someone moving them back up to the detail page's
 * header toolbar where they sit above the entries. Both are asserted against.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { CrmMeProvider, type Me } from "../CrmApp";

const navigate = vi.fn();
vi.mock("../routerHooks", async () => {
  const actual = await vi.importActual<any>("../routerHooks");
  return { ...actual, crmNavigate: (...a: any[]) => navigate(...a), useCrmParams: () => ({ id: "7" }) };
});

const APPROVALS_ROW = {
  id: 7,
  status: "Submitted",
  status_label: "Submitted",
  timesheet_period: "01 Aug 2026 – 31 Aug 2026",
  project_employee_name: "Amulya H K",
  project_type: "contract",
  total_hours_worked: 168,
  attachments: [],
};

const PO_OPTIONS = {
  pos: [
    { id: 1, po_number: "PO-2026-001", po_type: "Regular PO", status: "Active",
      start_date: "2026-01-01", total_value: 500000, used_value: 120000,
      balance_value: 380000, expired: false, selectable: true,
      project_allocated: 380000, project_used: 0 },
    { id: 2, po_number: "PO-2026-002", po_type: "Open PO", status: "Active",
      start_date: "2026-03-01", total_value: 200000, used_value: 0,
      balance_value: 200000, expired: false, selectable: true,
      project_allocated: null, project_used: null },
    // Expired but still selectable — billing often continues during renewal.
    { id: 3, po_number: "PO-2025-OLD", po_type: "Regular PO", status: "Active",
      start_date: "2025-01-01", end_date: "2025-12-31", total_value: 100000,
      used_value: 90000, balance_value: 10000, expired: true, selectable: true,
      project_allocated: null, project_used: null },
  ],
  selected_po_id: null,
  rate: {
    month: "2026-02", billing_unit: "Hourly", rate: 120, rate_split: false,
    sub_periods: [{ from: "2026-02-01", to: "2026-02-28", rate: 120 }],
    source: "Project Employee — Commercial Details",
    project_employee_id: 55,
    current_rate_row: { id: 9, effective_from: "2026-02-01", rate: 120 },
  },
};

const crmGet = vi.fn();
const crmPost = vi.fn();
const crmPutSpy = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<any>("../api");
  return {
    ...actual,
    crmGet: (...a: any[]) => crmGet(...a),
    crmPost: (...a: any[]) => crmPost(...a),
    crmPut: (...a: any[]) => crmPutSpy(...a),
    crmDelete: vi.fn(),
  };
});

import { TimesheetsListPage, TimesheetDetailPage } from "./Timesheets";

function me(roles: string[]): Me {
  return { id: 1, username: "u", full_name: "User", email: "u@example.com", roles };
}

/** One route table for both pages, so a test only says which roles are acting. */
function route(path: string) {
  if (path.includes("/po-options")) return { data: PO_OPTIONS, message: "" };
  if (path.includes("/reports/approvals")) return { data: [APPROVALS_ROW], message: "" };
  if (/\/api\/timesheets\/7$/.test(path)) {
    return {
      data: {
        id: 7, status: "Submitted", employee_id: 3, project_id: 1,
        period_start_date: "2026-08-01", period_end_date: "2026-08-31",
        timesheet_period: "01 Aug 2026 – 31 Aug 2026",
      },
      message: "",
    };
  }
  if (/\/api\/timesheets\/7\/entries/.test(path)) return { data: [], message: "" };
  if (/\/api\/timesheets\/7\/summary/.test(path)) return { data: {}, message: "" };
  return { data: [], message: "" };
}

beforeEach(() => {
  navigate.mockReset();
  crmPost.mockReset();
  crmGet.mockReset();
  crmGet.mockImplementation(async (path: string) => route(path));
});

async function renderApprovals(roles: string[]) {
  render(
    <CrmMeProvider value={me(roles)}>
      <TimesheetsListPage />
    </CrmMeProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /approvals/i }));
  return await screen.findByText("Amulya H K");
}

describe("Timesheet approvals list", () => {
  it("offers no Approve or Reject on the row — the decision needs the timesheet open", async () => {
    await renderApprovals(["RMG"]);
    expect(screen.queryByRole("button", { name: /^approve$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^reject$/i })).toBeNull();
  });

  it("opens the full timesheet when the row is clicked", async () => {
    const nameCell = await renderApprovals(["RMG"]);
    fireEvent.click(nameCell);
    expect(navigate).toHaveBeenCalledWith("timesheets/7");
  });

  it("labels the action Review for an approver, so the intent is to read it first", async () => {
    await renderApprovals(["RMG"]);
    const review = screen.getByRole("button", { name: /review/i });
    fireEvent.click(review);
    expect(navigate).toHaveBeenCalledWith("timesheets/7");
    // One navigation, not two: the cell stops the click reaching the row.
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("says Open, not Review, for HR — who reads timesheets but does not decide them", async () => {
    await renderApprovals(["HR"]);
    expect(screen.getByRole("button", { name: /^open$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /review/i })).toBeNull();
  });
});

describe("Timesheet detail — approval decision", () => {
  async function renderDetail(roles: string[]) {
    const { container } = render(
      <CrmMeProvider value={me(roles)}>
        <TimesheetDetailPage />
      </CrmMeProvider>,
    );
    await waitFor(() => expect(crmGet).toHaveBeenCalled());
    return container;
  }

  it("puts Approve/Reject after the daily grid and before Invoice Details", async () => {
    const container = await renderDetail(["RMG"]);
    const panel = await waitFor(() => {
      const el = container.querySelector("#approval-decision");
      if (!el) throw new Error("no approval panel");
      return el as HTMLElement;
    });
    expect(within(panel).getByRole("button", { name: /approve/i })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /reject/i })).toBeTruthy();

    // Ordering is the whole point, so assert it structurally rather than by eye.
    const grid = container.querySelector('[aria-label="Timesheet daily entries"]')!;
    const invoice = Array.from(container.querySelectorAll("*")).find(
      (n) => n.textContent?.trim() === "Invoice Details",
    );
    expect(grid.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    if (invoice) {
      expect(panel.compareDocumentPosition(invoice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("shows HR the timesheet but no decision buttons", async () => {
    const container = await renderDetail(["HR"]);
    await waitFor(() => expect(container.querySelector("table")).toBeTruthy());
    expect(container.querySelector("#approval-decision")).toBeNull();
    expect(screen.queryByRole("button", { name: /^approve$/i })).toBeNull();
  });

  it("grants Admin/CEO the decision through isSuperAdmin, with no explicit role row", async () => {
    const container = await renderDetail(["Admin"]);
    await waitFor(() => expect(container.querySelector("#approval-decision")).toBeTruthy());
  });
});

describe("PO selection gate before Generate Invoice", () => {
  async function openPoModal() {
    render(
      <CrmMeProvider value={me(["RMG"])}>
        <TimesheetsListPage />
      </CrmMeProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /approvals/i }));
    await screen.findByText("Amulya H K");
    // Approved + no invoice yet → the button is live but must open the gate,
    // not fire the POST.
    fireEvent.click(screen.getByRole("button", { name: /generate invoice/i }));
    await screen.findByText(/select po for this invoice/i);
  }

  beforeEach(() => {
    crmGet.mockImplementation(async (path: string) => {
      if (path.includes("/reports/approvals"))
        return { data: [{ ...APPROVALS_ROW, status: "Approved", status_label: "Approved" }], message: "" };
      return route(path);
    });
  });

  it("opens the PO gate instead of generating, and Generate stays disabled until a PO is picked", async () => {
    await openPoModal();
    expect(crmPost).not.toHaveBeenCalled();
    const generate = screen.getAllByRole("button", { name: /generate invoice/i })
      .find((b) => b.closest("[role=dialog], .fixed") || b.textContent === "Generate Invoice") as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
  });

  it("shows the month's Commercial Details rate at selection time", async () => {
    await openPoModal();
    expect(screen.getByText(/rate applied — february 2026/i)).toBeTruthy();
    expect(screen.getByText(/project employee — commercial details/i)).toBeTruthy();
  });

  it("lists every PO with balance and total, shows full details on pick, then generates with that po_id", { timeout: 15000 }, async () => {
    await openPoModal();
    // The report's filter bar has its own selects — the PO dropdown is the
    // one offering "Select PO…".
    const select = screen.getAllByRole("combobox")
      .find((s) => s.textContent?.includes("Select PO…")) as HTMLSelectElement;
    expect(select.textContent).toContain("PO-2026-001");
    expect(select.textContent).toContain("PO-2026-002");
    fireEvent.change(select, { target: { value: "1" } });
    // The detail card: total / used / balance / start month all visible.
    expect(screen.getByText(/total po amount/i)).toBeTruthy();
    expect(screen.getByText(/used amount/i)).toBeTruthy();
    expect(screen.getByText(/balance amount/i)).toBeTruthy();
    expect(screen.getByText(/po starts/i)).toBeTruthy();
    expect(screen.getByText("01 Jan 2026")).toBeTruthy();

    crmPost.mockResolvedValue({ message: "Invoice generated", data: {} });
    // The row button reads "Generate Invoice…" (it opens this gate); the
    // modal's commit button is exactly "Generate Invoice".
    const generate = screen.getAllByRole("button", { name: /generate invoice/i })
      .find((b) => b.textContent?.trim() === "Generate Invoice") as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    fireEvent.click(generate);
    await waitFor(() =>
      expect(crmPost).toHaveBeenCalledWith("/api/timesheets/7/generate-invoice", { po_id: 1 }),
    );
  });

  it("keeps an expired PO selectable, labelled, and badged in the detail card", async () => {
    await openPoModal();
    const select = screen.getAllByRole("combobox")
      .find((s) => s.textContent?.includes("Select PO…")) as HTMLSelectElement;
    const expiredOpt = Array.from(select.options).find((o) => o.value === "3")!;
    expect(expiredOpt.disabled).toBe(false);
    expect(expiredOpt.textContent).toMatch(/\(expired\)/i);
    fireEvent.change(select, { target: { value: "3" } });
    expect(screen.getByText("Expired")).toBeTruthy();
    // Generate is enabled for it too.
    const generate = screen.getAllByRole("button", { name: /generate invoice/i })
      .find((b) => b.textContent?.trim() === "Generate Invoice") as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
  });

  it("Edit Rate updates the current Commercial Details row from the panel", async () => {
    await openPoModal();
    fireEvent.click(screen.getByRole("button", { name: /edit rate/i }));
    crmPutSpy.mockResolvedValue({ message: "Rate updated", data: {} });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "130" } });
    fireEvent.click(screen.getByRole("button", { name: /save rate/i }));
    await waitFor(() => expect(crmPutSpy).toHaveBeenCalledWith(
      "/api/projects/employees/55/rates/9",
      { effective_from: "2026-02-01", rate: 130 },
    ));
  });

  it("Add Rate posts a new row; future-dated rates are not marked current", async () => {
    await openPoModal();
    fireEvent.click(screen.getByRole("button", { name: /add rate/i }));
    const dateInput = screen.getAllByLabelText(/effective from/i).pop() as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2099-01-01" } });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "150" } });
    crmPost.mockResolvedValue({ message: "Rate added", data: {} });
    fireEvent.click(screen.getByRole("button", { name: /^add rate$/i }));
    await waitFor(() => expect(crmPost).toHaveBeenCalledWith(
      "/api/projects/employees/55/rates",
      { effective_from: "2099-01-01", rate: 150, is_current_rate: false },
    ));
  });
});
