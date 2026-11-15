import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatEta, formatPercent } from "@/lib/format";

export type ProgressTone = "cosmic" | "model" | "planet" | "warn" | "danger";

const fills: Record<ProgressTone, string> = {
  cosmic: "bg-cosmic",
  model: "bg-gradient-to-r from-nebula to-cosmic",
  planet: "bg-signal-planet",
  warn: "bg-warn",
  danger: "bg-danger",
};

export interface ProgressBarProps {
  /** Fraction complete in [0, 1]; `null` renders an indeterminate bar. */
  value: number | null;
  label?: ReactNode;
  /** Seconds remaining (estimated); rendered as "about 3 min 05 s left". */
  etaSeconds?: number | null;
  /** Extra status text (e.g. "Epoch 12 / 50"). */
  detail?: ReactNode;
  showPercent?: boolean;
  tone?: ProgressTone;
  size?: "sm" | "md";
  className?: string;
}

/** Determinate (or indeterminate) progress with optional ETA text. */
export function ProgressBar({ value, label, etaSeconds, detail, showPercent = true, tone = "cosmic", size = "md", className }: ProgressBarProps) {
  const clamped = value === null ? null : Math.min(1, Math.max(0, value));
  const hasMeta = label || showPercent || etaSeconds !== undefined || detail;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {hasMeta ? (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate text-fg">{label}</span>
          {showPercent && clamped !== null ? <span className="num text-fg-secondary">{formatPercent(clamped, { digits: 0 })}</span> : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped === null ? undefined : Math.round(clamped * 100)}
        aria-valuetext={
          clamped === null
            ? "In progress"
            : `${formatPercent(clamped, { digits: 0 })}${etaSeconds !== undefined && etaSeconds !== null ? `, ${formatEta(etaSeconds)}` : ""}`
        }
        aria-label={typeof label === "string" ? label : undefined}
        className={cn("relative w-full overflow-hidden rounded-full bg-hairline", size === "sm" ? "h-1" : "h-1.5")}
      >
        {clamped === null ? (
          // Under reduced motion a parked 1/3-width segment would read as "33 % done", so the
          // bar becomes a faint full-width fill instead (the text says "In progress").
          <div
            className={cn(
              "absolute inset-y-0 w-1/3 animate-indeterminate rounded-full motion-reduce:left-0 motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40",
              fills[tone],
            )}
            data-testid="progress-indeterminate"
          />
        ) : (
          <div
            className={cn("h-full rounded-full transition-[width] duration-slow ease-out", fills[tone])}
            style={{ width: `${clamped * 100}%` }}
          />
        )}
      </div>
      {etaSeconds !== undefined || detail ? (
        <div className="flex items-baseline justify-between gap-3 text-xs text-fg-secondary">
          <span className="num">{detail}</span>
          {etaSeconds !== undefined ? <span className="num">{formatEta(etaSeconds)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
