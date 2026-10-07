/**
 * The bell's poll (7 Oct 2026): one `/summary` read a minute from a VISIBLE
 * tab, the 15-row list only when `latest_id` moved. Part of the "cut app ↔
 * database traffic" work — the old 30 s list poll ran from every tab, hidden
 * ones included, and again on every window focus.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";

import { ThemeProvider } from "../theme/ThemeProvider";

const crmGet = vi.fn();
vi.mock("./api", async () => {
  const actual = await vi.importActual<any>("./api");
  return { ...actual, crmGet: (...a: any[]) => crmGet(...a) };
});

import { NotificationsBell } from "./CrmApp";

const row = (id: number) => ({ id, title: `N${id}`, message: "m", link: null, is_read: true, created_at: "2026-10-07T10:00:00Z" });
const urls = () => crmGet.mock.calls.map((c) => String(c[0]));

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

async function mount() {
  crmGet.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/notifications/summary")) return { data: { unread_count: 0, latest_id: 2 } };
    return { data: [row(2), row(1)], meta: { unread_count: 0 } };
  });
  render(<ThemeProvider><NotificationsBell /></ThemeProvider>);
  await act(async () => { await Promise.resolve(); });
  expect(urls()).toEqual(["/api/notifications?limit=15"]);
}

beforeEach(() => {
  vi.useFakeTimers();
  crmGet.mockReset();
  setVisibility("visible");
});
afterEach(() => { vi.useRealTimers(); });

describe("NotificationsBell poll", () => {
  it("asks /summary once a minute and leaves the list alone while nothing moved", async () => {
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(urls()).toEqual(["/api/notifications?limit=15", "/api/notifications/summary"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(urls().filter((u) => u.includes("summary"))).toHaveLength(2);
    expect(urls().filter((u) => u.includes("limit="))).toHaveLength(1);
  });

  it("fetches only what is newer than the top row once latest_id moves", async () => {
    await mount();
    crmGet.mockImplementation(async (url: string) => {
      if (url.includes("summary")) return { data: { unread_count: 1, latest_id: 3 } };
      return { data: [{ ...row(3), is_read: false }], meta: { unread_count: 1 } };
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(urls().slice(1)).toEqual(["/api/notifications/summary", "/api/notifications?limit=15&since_id=2"]);
  });

  it("does not poll from a hidden tab, and polls at once (throttled) when it is shown again", async () => {
    await mount();
    setVisibility("hidden");
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(urls()).toHaveLength(1);
    setVisibility("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await Promise.resolve(); });
    expect(urls()).toEqual(["/api/notifications?limit=15", "/api/notifications/summary"]);
    // a focus a second later is inside the 15 s gap
    await act(async () => { window.dispatchEvent(new Event("focus")); await Promise.resolve(); });
    expect(urls()).toHaveLength(2);
  });
});
