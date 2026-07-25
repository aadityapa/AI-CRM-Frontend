/** Shared CRM breadcrumb trail for detail-page drill-down navigation. */
import React from "react";
import { CrmLink } from "../routerHooks";

export type CrmCrumb = {
  label: string;
  /** Omit `to` on the last (current) crumb — rendered as plain text. */
  to?: string;
};

const linkCls =
  "rounded-control text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300";

export function CrmBreadcrumb({ items }: { items: CrmCrumb[] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1.5">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${i}`}>
            {i > 0 && <span className="text-muted" aria-hidden="true">/</span>}
            {last || !item.to ? (
              <span
                className="text-sm font-semibold text-primary"
                aria-current={last ? "page" : undefined}
              >
                {item.label}
              </span>
            ) : (
              <CrmLink to={item.to} className={linkCls}>
                {item.label}
              </CrmLink>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
