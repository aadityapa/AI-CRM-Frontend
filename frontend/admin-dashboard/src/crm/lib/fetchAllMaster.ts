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
  const out: T[] = [];
  let page = 1;
  let pages = 1;
  do {
    const res = await crmGet<T[]>(`${path}${qs({ ...params, page, limit: PAGE_SIZE })}`);
    const rows = res.data || [];
    out.push(...rows);
    pages = res.meta?.pages ?? 1;
    // Defend against a meta that disagrees with reality.
    if (rows.length < PAGE_SIZE) break;
    page += 1;
  } while (page <= pages && page <= MAX_PAGES);
  return out;
}
