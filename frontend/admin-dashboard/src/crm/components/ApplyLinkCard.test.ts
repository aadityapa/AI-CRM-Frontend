import { describe, expect, it } from "vitest";
import { applyLinkState, shareLinks } from "./ApplyLinkCard";

describe("applyLinkState", () => {
  it("is pending before RMG approves", () => {
    expect(applyLinkState("Pending_Engineering_Review", false)).toBe("pending");
    expect(applyLinkState("Draft", false)).toBe("pending");
    expect(applyLinkState(null)).toBe("pending");
  });
  it("is open while the server says the form accepts applications", () => {
    expect(applyLinkState("Open_For_Sourcing", true)).toBe("open");
    expect(applyLinkState("In_Progress", true)).toBe("open");
  });
  it("is closed once sourcing stops", () => {
    expect(applyLinkState("On_Hold", false)).toBe("closed");
    expect(applyLinkState("Fulfilled", false)).toBe("closed");
  });
});

describe("shareLinks", () => {
  it("encodes the link and the post", () => {
    const s = shareLinks("https://x.in/apply/1-ab", "Hiring: A & B");
    expect(s.linkedin).toContain(encodeURIComponent("https://x.in/apply/1-ab"));
    expect(s.whatsapp).toContain("Hiring%3A%20A%20%26%20B");
  });
});
