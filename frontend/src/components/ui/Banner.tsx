import { FlaskConical, Info, OctagonAlert, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BannerTone = "info" | "warn" | "danger" | "fixture-model";

const tones: Record<BannerTone, { icon: ReactNode; className: string; iconClass: string }> = {
  info: { icon: <Info />, className: "border-cosmic/30 bg-cosmic/[0.06]", iconClass: "text-cosmic" },
  warn: { icon: <TriangleAlert />, className: "border-warn/30 bg-warn/[0.06]", iconClass: "text-warn" },
  danger: { icon: <OctagonAlert />, className: "border-danger/35 bg-danger/[0.06]", iconClass: "text-danger" },
  // Predictions from a fixture (pipeline-test) model must never be mistaken for real results.
  "fixture-model": {
    icon: <FlaskConical />,
    className: "border-dashed border-fg-muted/60 bg-fg/[0.03]",
    iconClass: "text-warn",
  },
};

export interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/** Inline notice. Danger banners are announced (role="alert"); others are polite (role="status"). */
export function Banner({ tone = "info", title, children, action, onDismiss, className }: BannerProps) {
  const t = tones[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      // Grid: icon | text | (action) | dismiss. Below sm the action drops under the text so it never
      // squeezes the message on phones.
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-lg border px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]",
        t.className,
        className,
      )}
      data-tone={tone}
    >
      <span className={cn("col-start-1 row-start-1 mt-0.5 flex shrink-0 [&_svg]:size-4", t.iconClass)} aria-hidden="true">
        {t.icon}
      </span>
      <div className="col-start-2 row-start-1 min-w-0 text-sm">
        {title ? <p className="font-semibold text-fg">{title}</p> : null}
        {children ? <div className={cn("text-fg-secondary", title && "mt-0.5")}>{children}</div> : null}
      </div>
      {action ? <div className="col-start-2 row-start-2 sm:col-start-3 sm:row-start-1 sm:self-center">{action}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="col-start-3 row-start-1 -mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-secondary hover:bg-fg/[0.06] hover:text-fg sm:col-start-4"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
