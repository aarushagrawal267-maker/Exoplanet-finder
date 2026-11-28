import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "cosmic" | "nebula" | "planet" | "fp" | "uncertain" | "warn" | "danger";

const soft: Record<BadgeTone, string> = {
  neutral: "border-hairline-strong bg-fg/[0.04] text-fg-secondary",
  cosmic: "border-cosmic/35 bg-cosmic/10 text-cosmic",
  // Test fixtures / synthetic data: dashed neutral, so it reads as "not real" without a new hue.
  nebula: "border-dashed border-fg-muted/60 bg-transparent text-fg-secondary",
  planet: "border-signal-planet/35 bg-signal-planet/10 text-signal-planet",
  fp: "border-signal-fp/35 bg-signal-fp/10 text-signal-fp",
  uncertain: "border-signal-uncertain/35 bg-signal-uncertain/10 text-signal-uncertain",
  warn: "border-warn/35 bg-warn/10 text-warn",
  danger: "border-danger/35 bg-danger/10 text-danger",
};

const dotColor: Record<BadgeTone, string> = {
  neutral: "bg-fg-secondary",
  cosmic: "bg-cosmic",
  nebula: "bg-fg-muted",
  planet: "bg-signal-planet",
  fp: "bg-signal-fp",
  uncertain: "bg-signal-uncertain",
  warn: "bg-warn",
  danger: "bg-danger",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: "sm" | "md";
  icon?: ReactNode;
  /** Small leading status dot (always paired with text, never colour alone). */
  dot?: boolean;
  /** Render the label in mono (IDs, counts, codes). */
  mono?: boolean;
}

/** Compact status / category label. */
export function Badge({ tone = "neutral", size = "sm", icon, dot, mono, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border font-medium [&_svg]:shrink-0",
        size === "sm" ? "h-6 px-2 text-xs [&_svg]:size-3" : "h-7 px-2.5 text-sm [&_svg]:size-3.5",
        mono && "num",
        soft[tone],
        className,
      )}
      {...rest}
    >
      {dot ? <span className={cn("size-1.5 rounded-full", dotColor[tone])} aria-hidden="true" /> : null}
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Keyboard key hint, e.g. <Kbd>Ctrl</Kbd><Kbd>K</Kbd>. */
export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-hairline-strong bg-space px-1 text-2xs normal-case tracking-normal text-fg-secondary",
        className,
      )}
      {...rest}
    />
  );
}
