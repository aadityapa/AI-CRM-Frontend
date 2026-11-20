// An interview tab keeps its own session (18 Nov 2026): node --test scripts/tests/
import { test } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

const shared = new MemoryStorage(); // localStorage — the dashboard's too
const tab = new MemoryStorage(); // this tab's sessionStorage
globalThis.window = { location: { search: "" }, localStorage: shared, sessionStorage: tab };

const s = await import("../../frontend/js/auth/session.js");

test("a recruiter's session and the candidate's interview never touch each other", () => {
  // The recruiter signs in on the dashboard (no invite in the address).
  window.location.search = "";
  s.saveAuthSession({ role: "hr" }, "staff-token", "");
  assert.equal(s.getAuthToken(), "staff-token");

  // The candidate's interview link in another tab of the same browser.
  window.location.search = "?invite=abc123";
  assert.equal(s.isInviteAuthScope(), true);
  assert.equal(s.getAuthToken(), "", "the interview must not pick up the recruiter's token");
  s.saveAuthSession({ role: "candidate" }, "invite-token", "");
  assert.equal(s.getAuthToken(), "invite-token");
  assert.equal(shared.getItem("authToken"), "staff-token", "signing the candidate in leaves the recruiter signed in");

  // The interview ends and clears its session — the recruiter stays signed in.
  s.clearAuthSession();
  assert.equal(s.getAuthToken(), "");
  assert.equal(shared.getItem("authToken"), "staff-token");

  // The recruiter signs out — the interview's own token is untouched.
  s.saveAuthSession({ role: "candidate" }, "invite-token", "");
  window.location.search = "";
  s.clearAuthSession();
  assert.equal(shared.getItem("authToken"), null);
  window.location.search = "?invite=abc123";
  assert.equal(s.getAuthToken(), "invite-token");
});
