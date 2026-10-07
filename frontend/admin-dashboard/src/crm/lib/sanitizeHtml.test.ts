/* The .docx preview sanitiser is security-critical (CVs arrive through the PUBLIC
   apply form; the auth token lives in localStorage on this origin) and had no test. */
import { describe, expect, it } from "vitest";

import { sanitizeHtml } from "./sanitizeHtml";

describe("sanitizeHtml", () => {
  it("drops scripts, event handlers and dangerous elements", () => {
    const out = sanitizeHtml(
      `<p onclick="steal()">Hi<script>alert(1)</script></p><img src="x.png" onerror="steal()">`
      + `<iframe src="https://evil"></iframe><svg><script>x()</script></svg>`,
    );
    expect(out).not.toMatch(/script|onclick|onerror|iframe|svg/i);
    expect(out).toContain("<p>Hi</p>");
    expect(out).toContain('src="x.png"');
  });

  it("removes javascript: and other unsafe links, including obfuscated ones", () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", " javascript:x",
      "vbscript:x", "data:text/html,<script>x</script>"]) {
      expect(sanitizeHtml(`<a href="${href}">x</a>`)).not.toContain("href");
    }
  });

  it("keeps safe links and opens them in a new tab without window.opener", () => {
    const out = sanitizeHtml(`<a href="https://karnexgroup.com" style="color:red">site</a>`);
    expect(out).toContain('href="https://karnexgroup.com"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
    expect(out).not.toContain("style");
    expect(sanitizeHtml(`<a href="mailto:a@b.com">m</a>`)).toContain("mailto:a@b.com");
  });

  it("allows only real image data URLs", () => {
    expect(sanitizeHtml(`<img src="data:image/png;base64,iVBORw0KGgo=">`)).toContain("data:image/png");
    expect(sanitizeHtml(`<img src="data:image/svg+xml;base64,PHN2Zz4=">`)).not.toContain("src");
  });

  it("unwraps unknown wrappers but keeps their text", () => {
    expect(sanitizeHtml(`<article><font color="red">Text</font></article>`)).toBe("Text");
    expect(sanitizeHtml("")).toBe("");
  });
});
