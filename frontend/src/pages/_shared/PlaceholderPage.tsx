/**
 * Placeholder used by pages whose content arrives in a later build phase. It states plainly what
 * the page will do — it never shows invented numbers.
 */
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ALL_NAV_ITEMS, HIDDEN_ROUTES, NAV_GROUPS } from "@/components/layout/nav";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export interface PlaceholderPageProps {
  /** Nav item id (see components/layout/nav.ts). */
  navId: string;
  /** Override the title (e.g. Target Dossier with a KIC id). */
  title?: ReactNode;
  description?: ReactNode;
  /** What the page will offer once wired to the API. */
  planned: string[];
  /** Related pages to link to. */
  related?: string[];
  actions?: ReactNode;
  meta?: ReactNode;
}

function eyebrowFor(navId: string): string {
  for (const g of NAV_GROUPS) {
    const idx = g.items.findIndex((i) => i.id === navId);
    if (idx >= 0) return `${g.label} · ${String(idx + 1).padStart(2, "0")}`;
  }
  return HIDDEN_ROUTES.find((r) => r.id === navId)?.groupLabel ?? "";
}

export function PlaceholderPage({ navId, title, description, planned, related = [], actions, meta }: PlaceholderPageProps) {
  const item = ALL_NAV_ITEMS.find((i) => i.id === navId) ?? HIDDEN_ROUTES.find((r) => r.id === navId);
  const links = related.map((id) => ALL_NAV_ITEMS.find((i) => i.id === id)).filter((i): i is NonNullable<typeof i> => Boolean(i));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={eyebrowFor(navId)} title={title ?? item?.label} description={description ?? item?.description} actions={actions} meta={meta} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <EmptyState
          title="This workspace comes online in the next build phase"
          description="The interface foundation is in place; this page is connected to the analysis API next. No data is shown until it comes from your own catalogue, light curves and models."
        />
        <Card>
          <div className="eyebrow mb-3 text-fg-secondary">What this page will do</div>
          <ul className="flex flex-col gap-2.5">
            {planned.map((p) => (
              <li key={p} className="flex gap-2.5 text-sm text-fg">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-cosmic" aria-hidden="true" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          {links.length ? (
            <div className="mt-5 flex flex-col gap-1 border-t border-hairline pt-4">
              <div className="eyebrow mb-1 text-fg-secondary">Related</div>
              {links.map((l) => (
                <Link key={l.id} to={l.path} className={buttonClasses({ variant: "ghost", size: "sm", className: "justify-between" })}>
                  {l.label}
                  <ArrowRight aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
