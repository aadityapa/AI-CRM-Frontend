import { describe, expect, it } from "vitest";
import { channelPost, channelUrl } from "../lib/careersLink";

describe("careers link per channel (3 Nov 2026)", () => {
  it("adds the source to the one link", () => {
    expect(channelUrl("https://karnexgroup.com/careers", "linkedin")).toBe("https://karnexgroup.com/careers?src=linkedin");
    expect(channelUrl("https://karnexgroup.com/careers", "")).toBe("https://karnexgroup.com/careers");
  });
  it("swaps the link inside the post", () => {
    const post = "Open now:\n• A\n\nApply: https://karnexgroup.com/careers\n#hiring";
    expect(channelPost(post, "https://karnexgroup.com/careers", "naukri"))
      .toContain("Apply: https://karnexgroup.com/careers?src=naukri");
  });
});
