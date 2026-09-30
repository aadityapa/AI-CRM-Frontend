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
 *
 * Since 23 Sep 2026 the approver is the GM (a custom role; in these tests it
 * is named directly, as `useHasRole` reads `me.roles`), and what the GM raises
 * from an approved sheet is a PROFORMA — Finance converts it on the invoice
 * page. Sales, who fills the sheet, sees "Open", never "Review".
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

/** `approvals` is what /api/me sends (server-computed, 25 Sep 2026): the GM
 *  role's Approvals are the three timesheet decisions; nobody else here has any. */
const GM_APPROVALS = ["timesheet.approve", "timesheet.reject", "timesheet.generate_invoice"];
function me(roles: string[], extra: Partial<Me> = {}): Me {
  return {
    id: 1, username: "u", full_name: "User", email: "u@example.com", roles,
    approvals: roles.includes("GM") ? GM_APPROVALS : [],
    ...extra,
  };
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
    await renderApprovals(["GM"]);
    expect(screen.queryByRole("button", { name: /^approve$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^reject$/i })).toBeNull();
  });

  it("opens the full timesheet when the row is clicked", async () => {
    const nameCell = await renderApprovals(["GM"]);
    fireEvent.click(nameCell);
    expect(navigate).toHaveBeenCalledWith("timesheets/7");
  });

  it("labels the action Review for the GM, so the intent is to read it first", async () => {
    await renderApprovals(["GM"]);
    const review = screen.getByRole("button", { name: /review/i });
    fireEvent.click(review);
    expect(navigate).toHaveBeenCalledWith("timesheets/7");
    // One navigation, not two: the cell stops the click reaching the row.
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it.each([["HR"], ["Sales"], ["RMG"]])(
    "says Open, not Review, for %s — they read (or fill) timesheets but do not decide them",
    async (role) => {
      await renderApprovals([role]);
      expect(screen.getByRole("button", { name: /^open$/i })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /review/i })).toBeNull();
    },
  );
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
    const container = await renderDetail(["GM"]);
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

  it.each([["HR"], ["Sales"]])("shows %s the timesheet but no decision buttons", async (role) => {
    const container = await renderDetail([role]);
    await waitFor(() => expect(container.querySelector("table")).toBeTruthy());
    expect(container.querySelector("#approval-decision")).toBeNull();
    expect(screen.queryByRole("button", { name: /^approve$/i })).toBeNull();
  });

  it("never shows Approve to Sales whose template grants Timesheets: Edit (the 25 Sep report)", async () => {
    // Sales needs Timesheets: Edit to FILL the sheet; that grant used to put
    // Approve/Reject in front of the person who filled it. Approvals now come
    // only from `me.approvals`.
    const salesTemplated = me(["Sales"], {
      access: { full: false, visible_tabs: ["timesheets"], tabs: { timesheets: "create" }, actions: [] },
    });
    const { container } = render(
      <CrmMeProvider value={salesTemplated}>
        <TimesheetDetailPage />
      </CrmMeProvider>,
    );
    await waitFor(() => expect(container.querySelector("table")).toBeTruthy());
    expect(container.querySelector("#approval-decision")).toBeNull();
    expect(screen.queryByRole("button", { name: /^approve$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^reject$/i })).toBeNull();
  });

  it("grants Admin/CEO the decision through isSuperAdmin, with no explicit role row", async () => {
    const container = await renderDetail(["Admin"]);
    await waitFor(() => expect(container.querySelector("#approval-decision")).toBeTruthy());
  });
});

const ALL_COLUMNS = { sac: true, leave: true, per_day: true };
/** The modal's commit button ("Raise Proforma Invoice"), as opposed to the row's "Raise Proforma…". */
/** A PO card in the picker (a radio), found by its number. */
const pickPo = (no: RegExp) =>
  screen.getAllByRole("radio").find((b) => no.test(b.textContent || "")) as HTMLButtonElement;
const commitButton = () =>
  screen.getAllByRole("button", { name: /raise proforma/i })
    .find((b) => b.textContent?.trim() === "Raise Proforma Invoice") as HTMLButtonElement;

describe("PO selection gate before raising the Proforma", () => {
  async function openPoModal() {
    render(
      <CrmMeProvider value={me(["GM"])}>
        <TimesheetsListPage />
      </CrmMeProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /approvals/i }));
    await screen.findByText("Amulya H K");
    // Approved + no invoice yet → the button is live but must open the gate,
    // not fire the POST.
    fireEvent.click(screen.getByRole("button", { name: /raise proforma/i }));
    // The format step is unique to the dialog — the GM confirms it first.
    await screen.findByText(/invoice format for this customer/i);
  }

  beforeEach(() => {
    crmGet.mockImplementation(async (path: string) => {
      if (path.includes("/reports/approvals"))
        return { data: [{ ...APPROVALS_ROW, status: "Approved", status_label: "Approved" }], message: "" };
      return route(path);
    });
  });

  it("opens the PO gate instead of generating, and Raise stays disabled until a PO is picked", async () => {
    await openPoModal();
    expect(crmPost).not.toHaveBeenCalled();
    expect(commitButton().disabled).toBe(true);
  });

  it("shows the month's Commercial Details rate at selection time", async () => {
    await openPoModal();
    expect(screen.getByText(/rate this month bills at — february 2026/i)).toBeTruthy();
    expect(screen.getByText(/project employee — commercial details/i)).toBeTruthy();
  });

  it("lists every PO with balance and total, shows full details on pick, then generates with that po_id", { timeout: 15000 }, async () => {
    await openPoModal();
    // The report's filter bar has its own selects — the PO dropdown is the
    // one offering "Select PO…".
    // The picker (30 Sep 2026) lists the POs as radio cards; every scope tab
    // is offered, "All customer POs" holds the whole book.
    fireEvent.click(screen.getByRole("tab", { name: /all customer pos/i }));
    expect(pickPo(/PO-2026-001/)).toBeTruthy();
    expect(pickPo(/PO-2026-002/)).toBeTruthy();
    fireEvent.click(pickPo(/PO-2026-001/));
    // The detail card: value / used / balance / period all visible.
    expect(screen.getByText(/^po value$/i)).toBeTruthy();
    expect(screen.getByText(/^used$/i)).toBeTruthy();
    expect(screen.getByText(/^balance$/i)).toBeTruthy();
    expect(screen.getAllByText(/^period$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/01 Jan 2026/).length).toBeGreaterThan(0);

    crmPost.mockResolvedValue({ message: "Proforma invoice raised", data: {} });
    const generate = commitButton();
    expect(generate.disabled).toBe(false);
    fireEvent.click(generate);
    // The confirmed column format travels with the PO — the server freezes it
    // on the Proforma and remembers it on the customer.
    await waitFor(() =>
      expect(crmPost).toHaveBeenCalledWith("/api/timesheets/7/generate-invoice",
        { po_id: 1, invoice_format: ALL_COLUMNS }),
    );
  });

  it("sends the customer's saved format pre-filled, and a column the GM unticks stays off", async () => {
    crmGet.mockImplementation(async (path: string) => {
      if (path.includes("/reports/approvals"))
        return { data: [{ ...APPROVALS_ROW, status: "Approved", status_label: "Approved" }], message: "" };
      if (path.includes("/po-options"))
        return { data: { ...PO_OPTIONS, invoice_format: { sac: true, leave: true, per_day: false } }, message: "" };
      return route(path);
    });
    await openPoModal();
    const perDay = screen.getByRole("checkbox", { name: /rate per day/i }) as HTMLInputElement;
    expect(perDay.checked).toBe(false);          // the saved choice arrives ticked/unticked as stored
    const sac = screen.getByRole("checkbox", { name: /sac code/i }) as HTMLInputElement;
    fireEvent.click(sac);                        // the GM changes their mind on one more column
    fireEvent.click(screen.getByRole("tab", { name: /all customer pos/i }));
    fireEvent.click(pickPo(/PO-2026-001/));
    crmPost.mockResolvedValue({ message: "ok", data: {} });
    fireEvent.click(commitButton());
    await waitFor(() =>
      expect(crmPost).toHaveBeenCalledWith("/api/timesheets/7/generate-invoice",
        { po_id: 1, invoice_format: { sac: false, leave: true, per_day: false } }),
    );
  });

  it("keeps an expired PO selectable, labelled, and badged in the detail card", async () => {
    await openPoModal();
    fireEvent.click(screen.getByRole("tab", { name: /all customer pos/i }));
    const expiredCard = pickPo(/PO-2025-OLD/);
    expect(expiredCard.disabled).toBe(false);
    expect(expiredCard.textContent).toMatch(/expired/i);
    fireEvent.click(expiredCard);
    // The card AND the detail panel both badge it.
    expect(screen.getAllByText("Expired").length).toBeGreaterThanOrEqual(2);
    // Raise is enabled for it too.
    expect(commitButton().disabled).toBe(false);
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
