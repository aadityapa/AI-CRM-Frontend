/** Fetch every row of a paginated CRM master list.
 *
 * `page_params` clamps `limit` to 100 server-side, so `?limit=200` silently
 * returns only the first 100 rows. Any dropdown built from a single request was
 * therefore truncated — with 250+ skills in the catalogue, real skills looked
 * missing and users created duplicates instead of picking the existing one.
 *
 * This pages until the server says there are no more.
 */
import { crmGet, qs } from "../api";

const PAGE_SIZE = 100;
/** Safety net so a bad `pages` value can never spin forever. */
const MAX_PAGES = 50;

export async function fetchAllMaster<T>(
  path: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  // A path that already carries a query string ("/api/designations?is_active=true")
  // is split so its params merge with ours — appending `?page=` produced
  // "?is_active=true?page=1" and a 422 that silently emptied the dropdown
  // (4 Sep 2026).
  const qIdx = path.indexOf("?");
  const base = qIdx >= 0 ? path.slice(0, qIdx) : path;
  const inline: Record<string, unknown> = {};
  if (qIdx >= 0) {
    new URLSearchParams(path.slice(qIdx + 1)).forEach((v, k) => { inline[k] = v; });
  }
  const out: T[] = [];
  let page = 1;
  let pages = 1;
  do {
    const res = await crmGet<T[]>(`${base}${qs({ ...inline, ...params, page, limit: PAGE_SIZE })}`);
    const rows = res.data || [];
    out.push(...rows);
    pages = res.meta?.pages ?? 1;
    // Defend against a meta that disagrees with reality.
    if (rows.length < PAGE_SIZE) break;
    page += 1;
  } while (page <= pages && page <= MAX_PAGES);
  return out;
}
