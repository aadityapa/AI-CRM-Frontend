/**
 * 23 Oct 2026 round: the pure helpers behind the HM dashboard, the Sales
 * invoice summary, the resume download name / zoom and the Admin correction.
 */
import { describe, expect, it } from "vitest";

import { downloadFileName, nextZoom } from "./components/FileUpload";
import { correctionSummary, type CorrectionOptions } from "./components/AdminCorrectionModal";
import { ddmmyyyy, rupees, summaryTsv } from "./pages/reports/InvoiceSummaryReport";
import { liveStages, waitedFor } from "./pages/dashboard/HiringManagerDashboard";

describe("resume download + zoom", () => {
  it("names the file after the candidate", () => {
    expect(downloadFileName("Ravi Kumar", "pdf")).toBe("Ravi Kumar.pdf");
    expect(downloadFileName("Ravi / Kumar?", ".DOCX")).toBe("Ravi Kumar.docx");
    expect(downloadFileName("Ravi Kumar.pdf", "pdf")).toBe("Ravi Kumar.pdf");
    expect(downloadFileName("", "pdf")).toBe("file.pdf");
  });
  it("steps the zoom and stops at the ends", () => {
    expect(nextZoom(1, 1)).toBe(1.25);
    expect(nextZoom(1, -1)).toBe(0.75);
    expect(nextZoom(3, 1)).toBe(3);
    expect(nextZoom(0.5, -1)).toBe(0.5);
  });
});

describe("invoice summary", () => {
  it("prints rupees and dates the way the customer receives them", () => {
    expect(rupees(226403)).toBe("₹ 2,26,403.00");
    expect(ddmmyyyy("2026-10-15")).toBe("15-10-2026");
    const tsv = summaryTsv({
      customer_id: 1, customer: "Harman",
      rows: [{ sr: 1, invoice_id: 9, invoice_number: "KRSW26-27-61", invoice_date: "2026-10-15",
        invoice_amount: 191866.93, tax_amount: 34536.05, total_amount: 226403,
        description: "Contract Staffing Service Anamalamudi Gowtham - Sep 2026" }],
      totals: { count: 1, invoice_amount: 191866.93, tax_amount: 34536.05, total_amount: 226403 },
    } as never);
    const lines = tsv.split("\n");
    expect(lines[0].split("\t")[0]).toBe("Sr.");
    expect(lines[1]).toContain("Contract Staffing Service Anamalamudi Gowtham - Sep 2026");
    expect(lines[2].startsWith("Total")).toBe(true);
  });
});

describe("hiring manager dashboard", () => {
  it("says how long something waited and drops empty stages", () => {
    const now = new Date("2026-10-23T10:00:00Z").getTime();
    expect(waitedFor("2026-10-23T08:00:00Z", now)).toBe("Today");
    expect(waitedFor("2026-10-20T08:00:00Z", now)).toBe("3 d");
    expect(waitedFor(null, now)).toBe("");
    expect(liveStages([{ key: "a", label: "A", count: 0 }, { key: "b", label: "B", count: 2 }] as never))
      .toEqual([{ key: "b", label: "B", count: 2 }]);
  });
});

describe("admin correction", () => {
  const opts: CorrectionOptions = {
    current: "RMG_Rejected", closed: true, stages: ["Sourcing", "Technical_Screening", "RMG_Rejected"],
    undo_to: "Technical_Screening", moves: [], screening: "Rejected", screening_values: ["Pending", "Shortlisted", "Rejected"],
    ai_decision: "rejected", ai_result: "Failed", archived: false, min_reason: 10,
  };
  it("lists only what would really change", () => {
    expect(correctionSummary(opts, { target: "RMG_Rejected", screening: "__leave__", clearAi: false, restore: false }))
      .toEqual([]);
    const changes = correctionSummary(opts, { target: "Technical_Screening", screening: "Pending", clearAi: true, restore: true });
    expect(changes).toHaveLength(3);          // restore ignored: the row is not archived
    expect(changes[1]).toContain("Rejected → Pending");
  });
});
