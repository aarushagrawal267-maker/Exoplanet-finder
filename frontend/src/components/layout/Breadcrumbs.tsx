import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import type { Crumb } from "./nav";

/** Path breadcrumbs: group → page (→ entity). The last crumb is the current page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={`${c.label}-${i}`}>
              {i > 0 ? (
                <li aria-hidden="true" className="hidden text-fg-muted sm:block">
                  <ChevronRight className="size-3.5" />
                </li>
              ) : null}
              <li className={last ? "min-w-0 truncate font-medium text-fg" : "hidden shrink-0 text-fg-secondary sm:block"} aria-current={last ? "page" : undefined}>
                {c.path && !last ? (
                  <Link to={c.path} className="rounded-sm hover:text-fg">
                    {c.label}
                  </Link>
                ) : (
                  c.label
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
