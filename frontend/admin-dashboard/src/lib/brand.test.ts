/**
 * The application is "Karnex Orbit" (26 Sep 2026). `lib/brand.ts` is the ONE
 * name the dashboard prints; the old product names must not come back into
 * anything a person reads. "Karnex" alone stays the company name.
 *
 * Sources are read through Vite's `import.meta.glob(…, { query: "?raw" })`
 * so the scan needs no Node typings (tsconfig has none).
 */
import { describe, expect, it } from "vitest";

import { APP_NAME, APP_NAME_UPPER } from "./brand";

const OLD_NAMES = [
  "Karnex CRM", "KARNEX CRM", "AI HR Suite", "AI HR SUITE", "KARNEX AI HR",
  "AI Assessment Center", "AI Hiring OS", "Enterprise AI Interview Platform",
];

const DASHBOARD = import.meta.glob(["../**/*.{ts,tsx}", "../../index.html", "!../**/*.test.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const RUNTIME = import.meta.glob(
  ["../../../index.html", "../../../thank-you.html", "../../../interview-terminated.html", "../../../js/results.js"],
  { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** JSX text and string literals only — comments and doc blocks stripped. */
function visibleText(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function offenders(files: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [file, source] of Object.entries(files)) {
    const text = visibleText(source);
    for (const old of OLD_NAMES) if (text.includes(old)) out.push(`${file}: ${old}`);
  }
  return out;
}

describe("brand", () => {
  it("names the product Karnex Orbit", () => {
    expect(APP_NAME).toBe("Karnex Orbit");
    expect(APP_NAME_UPPER).toBe(APP_NAME.toUpperCase());
  });

  it("keeps the old product names out of the dashboard's visible text", () => {
    expect(Object.keys(DASHBOARD).length).toBeGreaterThan(100);
    expect(offenders(DASHBOARD)).toEqual([]);
  });

  it("keeps the old product names out of the candidate runtime pages", () => {
    expect(Object.keys(RUNTIME)).toHaveLength(4);
    expect(offenders(RUNTIME)).toEqual([]);
  });
});
