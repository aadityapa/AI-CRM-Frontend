/**
 * Phone parsing / formatting built on libphonenumber-js.
 *
 * This is the ONLY module allowed to import the library — every other file
 * (form renderer, autofill, save paths) goes through these helpers so the
 * dependency stays isolated and easy to typecheck/mock.
 */
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export type ParsedPhone = {
  /** Calling code with plus sign, e.g. "+91". */
  countryCode: string;
  /** National significant number (digits only), e.g. "9876543210". */
  national: string;
  /** Canonical E.164 form, e.g. "+919876543210". */
  e164: string;
};

/** A string that is only a country code ("+91") — a sentinel, not a number. */
const BARE_COUNTRY_CODE = /^\+\d{1,4}$/;

/**
 * Parse any stored phone representation into its parts.
 *
 * Handles bare national numbers ("9876543210" → assumes `defaultCountry`),
 * already-E.164 ("+919876543210"), and spaced/dashed forms
 * ("+91 98765 43210", "091-98765-43210"). Returns null for empty, bare
 * country-code sentinels, or anything libphonenumber cannot recognise.
 */
function lenientDigitsFallback(s: string): ParsedPhone | null {
  const digits = s.replace(/\D/g, "");
  if (digits.length < 6) return null;
  if (digits.length === 10) {
    return { countryCode: "+91", national: digits, e164: `+91${digits}` };
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    const national = digits.slice(2);
    return { countryCode: "+91", national, e164: `+${digits}` };
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    const national = digits.slice(1);
    return { countryCode: "+91", national, e164: `+91${national}` };
  }
  // Legacy CRM data: bare digit strings that libphonenumber rejects (e.g. 11-digit
  // values entered without country code). Keep them visible under +91.
  return { countryCode: "+91", national: digits, e164: `+91${digits}` };
}

export function parsePhone(
  raw: string | null | undefined,
  defaultCountry: CountryCode = "IN",
): ParsedPhone | null {
  const s = String(raw ?? "").trim();
  if (!s || BARE_COUNTRY_CODE.test(s)) return null;
  const pn = parsePhoneNumberFromString(s, defaultCountry);
  if (pn && (pn.isValid() || pn.isPossible())) {
    return {
      countryCode: `+${pn.countryCallingCode}`,
      national: String(pn.nationalNumber),
      e164: String(pn.number),
    };
  }
  return lenientDigitsFallback(s);
}

/**
 * Combine a country code + national number into E.164 for persistence.
 * Returns "" when there is no national number. Falls back to the naive
 * "+<cc><digits>" concatenation if the library cannot validate the pair
 * (never throws, never loses digits).
 */
export function formatE164(countryCode: string, national: string): string {
  const digits = String(national ?? "").replace(/\D/g, "");
  if (!digits) return "";
  let cc = String(countryCode ?? "").trim().replace(/[^\d+]/g, "");
  if (!cc) cc = "+91";
  if (!cc.startsWith("+")) cc = `+${cc}`;
  const parsed = parsePhone(`${cc}${digits}`);
  return parsed ? parsed.e164 : `${cc}${digits}`;
}

/**
 * Normalize a free-text phone value for saving:
 *  - empty / bare "+91" sentinel → "" (no phone)
 *  - parseable → E.164
 *  - unparseable non-empty → returned as-is (never destroy user data)
 */
export function normalizePhoneForSave(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s || BARE_COUNTRY_CODE.test(s)) return "";
  const parsed = parsePhone(s);
  return parsed ? parsed.e164 : s;
}

/**
 * Display form for the split tel control: "+91 9876543210".
 * Unparseable non-empty input is returned as-is so it is never silently
 * blanked; empty / sentinel input yields "".
 */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s || BARE_COUNTRY_CODE.test(s)) return "";
  const parsed = parsePhone(s);
  return parsed ? `${parsed.countryCode} ${parsed.national}` : s;
}

/** True when the value contains an actual number (not empty, not a bare "+CC"). */
export function hasPhoneNumber(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim();
  return !!s && !BARE_COUNTRY_CODE.test(s);
}
