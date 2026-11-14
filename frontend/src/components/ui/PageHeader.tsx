import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PageHeaderProps {
  /** Small uppercase mono label above the title (e.g. "Observe · 02"). */
  eyebrow?: ReactNode;
  /** Page title, set in Instrument Serif italic. */
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned actions (buttons). */
  actions?: ReactNode;
  /** Chips / badges row under the description. */
  meta?: ReactNode;
  className?: string;
}

/** Page masthead: eyebrow → serif title → description, with actions on the right. */
export function PageHeader({ eyebrow, title, description, actions, meta, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4 pb-6 md:flex-row md:items-end md:justify-between md:gap-8", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="eyebrow mb-2 flex items-center gap-2 text-fg-secondary">
            <span className="h-px w-5 bg-gradient-to-r from-nebula to-cosmic" aria-hidden="true" />
            {eyebrow}
          </div>
        ) : null}
        <h1 className="font-display text-xl text-fg md:text-2xl">{title}</h1>
        {description ? <p className="mt-2 max-w-prose text-base text-fg-secondary md:text-md">{description}</p> : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
