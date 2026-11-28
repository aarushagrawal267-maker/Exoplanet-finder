import type { ReactNode } from "react";
import { OrbitArt } from "@/components/brand/OrbitArt";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** Primary / secondary actions (buttons or links). */
  actions?: ReactNode;
  /** Replace the default orbit line-art. */
  art?: ReactNode;
  /** Faint starfield + plate grid backdrop (hero / empty states only). */
  atmosphere?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/** "Nothing here yet" panel with orbit line-art and a clear next step. */
export function EmptyState({ title, description, actions, art, atmosphere = true, size = "md", className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-card border border-dashed border-hairline-strong text-center",
        size === "sm" ? "gap-3 px-6 py-8" : "gap-4 px-8 py-14",
        atmosphere && "atmosphere overflow-hidden",
        className,
      )}
    >
      {art ?? <OrbitArt width={size === "sm" ? 128 : 168} />}
      <div className="flex max-w-md flex-col gap-1.5">
        <h3 className={cn("font-medium text-fg", size === "sm" ? "text-lg" : "text-xl")}>{title}</h3>
        {description ? <p className="text-base text-fg-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
