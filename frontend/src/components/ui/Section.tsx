import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SectionProps {
  title?: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
  children?: ReactNode;
  className?: string;
}

/** A titled block within a page. Titles are 20 px sans, medium weight (the serif is reserved for page titles). */
export function Section({ title, eyebrow, description, actions, id, children, className }: SectionProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={title ? headingId : undefined} className={cn("scroll-mt-20", className)}>
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {eyebrow ? <div className="eyebrow mb-1 text-fg-secondary">{eyebrow}</div> : null}
            {title ? (
              <h2 id={headingId} className="text-lg font-medium text-fg">
                {title}
              </h2>
            ) : null}
            {description ? <p className="mt-1 max-w-prose text-sm text-fg-secondary">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
