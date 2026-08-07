/** Placeholder-email handling for imported candidates.
 *
 * `candidates.email` is UNIQUE and NOT NULL, so a candidate who genuinely had no
 * email address in Zoho still needs *something* stored. The importers synthesise
 * `<name>.<hash>@import.karnex.in` for those rows.
 *
 * That address is an internal artifact, never a way to reach anyone — so it must
 * not be shown as if it were a real contact detail, and must never be used as a
 * send-to address. It stays in the database because it keeps the row unique and
 * lets a re-import find the candidate again.
 */

/** Domain used by tools/import_candidates_json.py and import_candidates_full.py. */
export const PLACEHOLDER_EMAIL_DOMAIN = "import.karnex.in";

export function isPlaceholderEmail(email?: string | null): boolean {
  return (email || "").trim().toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

/** The address to show, or null when there isn't a real one. */
export function realEmail(email?: string | null): string | null {
  const value = (email || "").trim();
  if (!value || isPlaceholderEmail(value)) return null;
  return value;
}

/** Display string for a table cell or detail row. */
export function displayEmail(email?: string | null, fallback = "— no email"): string {
  return realEmail(email) ?? fallback;
}
