/** Re-exports of the CRM mini-router (kept separate so CrmApp and pages share one import site). */
export {
  CrmLink, CrmRouter, crmNavigate, crmUrl, matchRoute, readCrmPath, useCrmParams, useCrmPath,
} from "./router";
export type { CrmRoute } from "./router";

/** Convenience: is the current CRM path under the given prefix? */
import { useCrmPath } from "./router";
export function useCrmPathActive(prefix: string): boolean {
  const p = useCrmPath();
  return prefix === "" ? p === "" : p === prefix || p.startsWith(prefix + "/");
}
