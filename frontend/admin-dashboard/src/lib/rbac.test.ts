import { describe, it, expect } from "vitest";
import {
  allowedInterviewNav,
  canAccessInterviewView,
  defaultLanding,
  hasCrmAccess,
  hasInterviewAccess,
} from "./rbac";

describe("RBAC — default landing per role", () => {
  it("Admin lands on CRM", () => expect(defaultLanding(["Admin"])).toBe("crm"));
  it("Sales lands on CRM", () => expect(defaultLanding(["Sales"])).toBe("crm"));
  it("Sales_Head lands on CRM", () => expect(defaultLanding(["Sales_Head"])).toBe("crm"));
  it("Finance lands on CRM", () => expect(defaultLanding(["Finance"])).toBe("crm"));
  it("TA lands on CRM", () => expect(defaultLanding(["TA"])).toBe("crm"));
  it("HR lands on CRM", () => expect(defaultLanding(["HR"])).toBe("crm"));
  it("RMG lands on CRM", () => expect(defaultLanding(["RMG"])).toBe("crm"));
  it("multi-role: Admin wins", () => expect(defaultLanding(["Sales", "Admin"])).toBe("crm"));
  it("multi-role: still CRM when Interview + Finance", () =>
    expect(defaultLanding(["TA", "Finance"])).toBe("crm"));
});

describe("RBAC — Interview Platform nav visibility", () => {
  it("Admin sees all six", () =>
    expect(allowedInterviewNav(["Admin"])).toEqual([
      "dashboard", "templates", "candidates", "ats", "promptLogs", "integrityLogs",
    ]));
  it("TA sees Dashboard/Reports/ATS/Integrity (no Templates, no AI Logs)", () =>
    expect(allowedInterviewNav(["TA"])).toEqual(["dashboard", "candidates", "ats", "integrityLogs"]));
  it("HR matches TA", () =>
    expect(allowedInterviewNav(["HR"])).toEqual(["dashboard", "candidates", "ats", "integrityLogs"]));
  it("RMG sees Templates/Dashboard/Reports/ATS (no Integrity)", () =>
    expect(allowedInterviewNav(["RMG"])).toEqual(["dashboard", "templates", "candidates", "ats"]));
  it("Sales sees no Interview Platform nav", () => expect(allowedInterviewNav(["Sales"])).toEqual([]));
  it("Sales_Head sees none", () => expect(allowedInterviewNav(["Sales_Head"])).toEqual([]));
  it("Finance sees none", () => expect(allowedInterviewNav(["Finance"])).toEqual([]));
});

describe("RBAC — platform access (CRM-only roles excluded)", () => {
  it.each(["Admin", "TA", "HR", "RMG"])("%s has platform access", (r) =>
    expect(hasInterviewAccess([r])).toBe(true));
  it.each(["Sales", "Sales_Head", "Finance"])("%s has no platform access", (r) =>
    expect(hasInterviewAccess([r])).toBe(false));
});

describe("RBAC — Integrity is Admin/TA/HR only (RMG excluded)", () => {
  it.each(["Admin", "TA", "HR"])("%s can access Integrity", (r) =>
    expect(canAccessInterviewView([r], "integrityLogs")).toBe(true));
  it.each(["RMG", "Sales", "Finance"])("%s cannot access Integrity", (r) =>
    expect(canAccessInterviewView([r], "integrityLogs")).toBe(false));
});

describe("RBAC — Templates is Admin/RMG only", () => {
  it.each(["Admin", "RMG"])("%s can access Templates", (r) =>
    expect(canAccessInterviewView([r], "templates")).toBe(true));
  it.each(["TA", "HR"])("%s cannot access Templates", (r) =>
    expect(canAccessInterviewView([r], "templates")).toBe(false));
});

describe("RBAC — AI Logs is Admin only", () => {
  it("TA cannot access AI Logs", () => expect(canAccessInterviewView(["TA"], "promptLogs")).toBe(false));
  it("Admin can access AI Logs", () => expect(canAccessInterviewView(["Admin"], "promptLogs")).toBe(true));
});

describe("RBAC — CRM access", () => {
  it("Sales has CRM access", () => expect(hasCrmAccess(["Sales"])).toBe(true));
  it("Finance has CRM access", () => expect(hasCrmAccess(["Finance"])).toBe(true));
  it("no roles → no CRM access", () => expect(hasCrmAccess([])).toBe(false));
});
