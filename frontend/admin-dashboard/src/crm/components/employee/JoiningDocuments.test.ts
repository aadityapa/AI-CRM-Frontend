import { describe, expect, it } from "vitest";
import { docFilter, fileSize, groupIcon, type DocItem } from "./JoiningDocuments";
import { deploymentChoice, tenureText } from "../../pages/Employees";

const item = (over: Partial<DocItem>): DocItem => ({
  type_id: 1, group: "Identity Document Collection", name: "PAN Card", description: null, required: true,
  hidden_from_list: false, state: "missing", files: [], note: null, checked_by_name: null, checked_at: null,
  updated_at: null, ...over,
});

describe("Employee ▸ Joining Documents and the list (26 Nov 2026)", () => {
  it("filters the checklist the way HR reads it", () => {
    const items = [
      item({ type_id: 1, state: "missing" }),
      item({ type_id: 2, state: "missing", required: false }),
      item({ type_id: 3, state: "received" }),
      item({ type_id: 4, state: "verified" }),
      item({ type_id: 5, state: "not_applicable" }),
    ];
    expect(docFilter(items, "todo").map((i) => i.type_id)).toEqual([1]);       // optional ones never nag
    expect(docFilter(items, "received").map((i) => i.type_id)).toEqual([3]);
    expect(docFilter(items, "verified").map((i) => i.type_id)).toEqual([4, 5]);
    expect(docFilter(items, "all")).toHaveLength(5);
    expect(fileSize(500)).toBe("500 B");
    expect(fileSize(250 * 1024)).toBe("250 KB");
    expect(fileSize(1.25 * 1024 * 1024)).toBe("1.3 MB");
    expect(groupIcon("Education")).not.toBe(groupIcon("Identity Document Collection"));
  });

  it("reads the deployment dropdown and the tenure line", () => {
    expect(deploymentChoice("bench")).toBe("bench");
    expect(deploymentChoice("group:4")).toBe("group:4");
    expect(deploymentChoice("group:x")).toBe("");
    expect(deploymentChoice(null)).toBe("");
    const today = new Date(2026, 10, 26);
    expect(tenureText("2022-09-01", today)).toBe("4 yrs 2 mos");
    expect(tenureText("2026-11-03", today)).toBe("New this month");
    expect(tenureText("2027-01-01", today)).toBeNull();
    expect(tenureText(null, today)).toBeNull();
  });
});
