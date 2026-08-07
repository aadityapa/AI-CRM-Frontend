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
  const mobileItems =
    items.length > 2 ? [items[0], { label: "…" }, items[items.length - 1]] : items;
  return (
    <nav aria-label="Breadcrumb" className="mb-1 min-w-0">
      <div className="min-w-0 sm:hidden">
        <span className="block truncate text-sm font-semibold text-primary" aria-current="page">
          {mobileItems.map((item) => item.label).join(" / ")}
        </span>
      </div>
      <ol className="hidden min-w-0 flex-wrap items-center gap-1.5 sm:flex">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <React.Fragment key={`${item.label}-${i}`}>
              {i > 0 && <li className="text-muted" aria-hidden="true">/</li>}
              <li className="min-w-0">
                {last || !item.to ? (
                  <span
                    className="block truncate text-sm font-semibold text-primary"
                    aria-current={last ? "page" : undefined}
                  >
                    {item.label}
                  </span>
                ) : (
                  <CrmLink to={item.to} className={`${linkCls} block truncate`}>
                    {item.label}
                  </CrmLink>
                )}
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
