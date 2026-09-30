/** The round editors' time field is the IST wall clock (28 Sep 2026 bug:
 *  every edit moved the interview 5h30 earlier). */
import { describe, expect, it } from "vitest";

import { isoToIstInput } from "./datetime";

describe("isoToIstInput", () => {
  it("shows an aware UTC instant as the IST wall clock", () => {
    expect(isoToIstInput("2026-09-28T05:24:00+00:00")).toBe("2026-09-28T10:54");
    expect(isoToIstInput("2026-09-27T20:00:00Z")).toBe("2026-09-28T01:30");
  });
  it("keeps an IST-offset or naive stamp as typed", () => {
    expect(isoToIstInput("2026-09-28T10:54:00+05:30")).toBe("2026-09-28T10:54");
    expect(isoToIstInput("2026-09-28 10:54")).toBe("2026-09-28T10:54");
  });
  it("gives an empty field for nothing or garbage", () => {
    expect(isoToIstInput(null)).toBe("");
    expect(isoToIstInput("tomorrow at ten")).toBe("");
  });
});
