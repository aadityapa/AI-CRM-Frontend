import { describe, expect, it } from "vitest";
import {
  countryOptions,
  formatE164,
  formatPhoneDisplay,
  hasPhoneNumber,
  isoForDial,
  normalizePhoneForSave,
  parsePhone,
} from "./phone";
import { branchContactAutofill } from "./contactPhone";

const LAKSHMI = {
  id: 9,
  name: "Lakshmi Devi",
  email: "lakshmi@harman.com",
  phone: "+918767998766",
  is_hiring_manager: false,
};
const RAMYA = {
  id: 10,
  name: "Ramya",
  email: "ramya@harman.com",
  phone: "+918767897654",
  is_hiring_manager: true,
};

describe("phone helpers", () => {
  it("parses 10-digit national number", () => {
    expect(parsePhone("1234567895")).toEqual({
      countryCode: "+91",
      national: "1234567895",
      e164: "+911234567895",
    });
  });

  it("parses E.164 India numbers", () => {
    expect(formatPhoneDisplay("+918767998766")).toBe("+91 8767998766");
  });

  it("treats bare +91 as empty", () => {
    expect(hasPhoneNumber("+91")).toBe(false);
    expect(formatPhoneDisplay("+91")).toBe("");
    expect(normalizePhoneForSave("+91")).toBe("");
  });

  it("normalizes display to E.164 on save", () => {
    expect(normalizePhoneForSave("+91 8767998766")).toBe("+918767998766");
    expect(formatE164("+91", "8767998766")).toBe("+918767998766");
  });
});

describe("contactPhone autofill", () => {
  it("sole contact + sole HM auto-select ids, emails, and phones", () => {
    const only = { ...LAKSHMI, is_hiring_manager: true };
    const fill = branchContactAutofill([only]);
    expect(fill.contact_person_id).toBe("9");
    expect(fill.hiring_manager_id).toBe("9");
    expect(fill.contact_email).toBe("lakshmi@harman.com");
    expect(fill.hiring_manager_email).toBe("lakshmi@harman.com");
    expect(fill.contact_phone).toBe("+918767998766");
    expect(fill.hiring_manager_contact).toBe("+918767998766");
  });

  it("multiple contacts: does not guess contact person; still picks sole HM with phone", () => {
    const fill = branchContactAutofill([LAKSHMI, RAMYA]);
    expect(fill.contact_person_id).toBe("");
    expect(fill.hiring_manager_id).toBe("10");
    expect(fill.contact_email).toBe("");
    expect(fill.contact_phone).toBe("");
    expect(fill.hiring_manager_email).toBe("ramya@harman.com");
    expect(fill.hiring_manager_contact).toBe("+918767897654");
  });
});

/* ------------------------------------------------------------ country picker */
describe("countryOptions (1 Sep 2026 — country dropdown on phone fields)", () => {
  it("lists every country with a name and a dial code, India first", () => {
    const all = countryOptions();
    expect(all.length).toBeGreaterThan(200);
    expect(all[0]).toMatchObject({ iso: "IN", dial: "+91" });
    // Names come from Intl.DisplayNames; the ISO code is the fallback, so the
    // only hard requirement is that nothing is blank.
    expect(all.every((c) => !!c.name && /^\+\d+$/.test(c.dial))).toBe(true);
  });

  it("puts the everyday destinations above the alphabetical tail", () => {
    const top = countryOptions().slice(0, 8).map((c) => c.iso);
    expect(top).toContain("US");
    expect(top).toContain("AE");
    const rest = countryOptions().slice(8).map((c) => c.name);
    expect([...rest].sort((a, b) => a.localeCompare(b))).toEqual(rest);
  });

  it("resolves a dial code back to a country, preferring the pinned one", () => {
    expect(isoForDial("+91")).toBe("IN");
    // +1 is shared by the US and Canada — the pinned order decides.
    expect(isoForDial("+1")).toBe("US");
    expect(isoForDial("+9999")).toBeNull();
  });
});
