import { describe, expect, it } from "vitest";
import { resetSubTabs, subTabState, toggleSubTab } from "./TabPermissionMatrix";
import { subTabChoice, subTabVisible } from "../useAccess";

const SUBS = [{ key: "tab:opportunities" }, { key: "tab:profiles" }, { key: "tab:financial" }, { key: "tab:revenue" }];

describe("sub-tab picker (22 Oct 2026)", () => {
  it("follows the role until one is unticked, then the ticks decide", () => {
    expect(subTabState({}, "tab:revenue")).toEqual({ checked: true, picked: false });
    const once = toggleSubTab({ export: "view" }, SUBS, "tab:opportunities");
    expect(once).toEqual({
      export: "view", "tab:opportunities": "hidden", "tab:profiles": "view",
      "tab:financial": "view", "tab:revenue": "view",
    });
    expect(subTabState(once, "tab:opportunities")).toEqual({ checked: false, picked: true });
    expect(resetSubTabs(once)).toEqual({ export: "view" });
  });

  it("the access helper mirrors the server rule", () => {
    const access = {
      visible_tabs: ["reports"], tabs: { reports: "view" as const },
      fields: { reports: { "tab:financial": "view" as const, "tab:revenue": "view" as const } },
    };
    expect(subTabChoice(access, ["Finance"], "reports", "revenue")).toBe("show");
    expect(subTabChoice(access, ["Finance"], "reports", "opportunities")).toBe("hide");
    // A tick opens Revenue even when the role alone would not.
    expect(subTabVisible(access, ["GM"], "reports", "tab:revenue", false)).toBe(true);
    // No template rule → the role decides.
    const untouched = { visible_tabs: ["reports"], tabs: { reports: "view" as const }, fields: {} };
    expect(subTabVisible(untouched, ["TA"], "reports", "revenue", false)).toBe(false);
    expect(subTabVisible(untouched, ["TA"], "reports", "opportunities")).toBe(true);
    // Untemplated logins always get the role default.
    expect(subTabChoice(undefined, ["Sales"], "reports", "revenue")).toBe("default");
  });
});
