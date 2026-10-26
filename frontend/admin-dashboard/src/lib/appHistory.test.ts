/**
 * 23 Oct 2026 — Back / Forward stay inside the app and never step on a dead
 * entry (the same address pushed twice).
 */
import { beforeEach, describe, expect, it } from "vitest";

import { canGoBack, canGoForward, historyIndex, initAppHistory, pushAppHistory } from "./appHistory";

describe("app history", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/admin/?view=crm");
    initAppHistory();
  });

  it("starts at 0 — Back would leave the app, so it is off", () => {
    expect(historyIndex()).toBe(0);
    expect(canGoBack()).toBe(false);
    expect(canGoForward()).toBe(false);
  });

  it("numbers each push and replaces the address already on screen", () => {
    pushAppHistory("/admin/?view=crm&p=invoices");
    expect(historyIndex()).toBe(1);
    pushAppHistory("/admin/?view=crm&p=invoices");          // same address: no dead entry
    expect(historyIndex()).toBe(1);
    pushAppHistory("/admin/?view=crm&p=invoices/7");
    expect(historyIndex()).toBe(2);
    expect(canGoBack()).toBe(true);
    expect(canGoForward()).toBe(false);
  });
});
