import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Padding = "none" | "sm" | "md" | "lg";
const paddings: Record<Padding, string> = { none: "", sm: "p-3", md: "p-5", lg: "p-6" };

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: Padding;
  /** Hover affordance for clickable cards. */
  interactive?: boolean;
  /** Raised variant (popovers, nested cards). */
  raised?: boolean;
}

/** Surface container: 1px hairline border, 12px radius, faint top-edge highlight. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = "md", interactive = false, raised = false, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "card-surface",
        raised && "bg-surface-raised",
        interactive && "transition-colors duration-fast hover:border-hairline-strong",
        paddings[padding],
        className,
      )}
      {...rest}
    />
  );
});

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

/** Card heading row: optional eyebrow, title, description and right-aligned actions. */
export function CardHeader({ title, eyebrow, description, actions, className, children, ...rest }: CardHeaderProps) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-4", className)} {...rest}>
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1 text-fg-secondary">{eyebrow}</div> : null}
        {title ? <h3 className="text-md font-semibold leading-6 text-fg">{title}</h3> : null}
        {description ? <p className="mt-1 text-sm text-fg-secondary">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-5 flex items-center justify-end gap-2 border-t border-hairline pt-4", className)} {...rest} />;
}
