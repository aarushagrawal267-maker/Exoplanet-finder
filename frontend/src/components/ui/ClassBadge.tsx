import { CircleHelp, CircleSlash2, Orbit } from "lucide-react";
import type { ReactNode } from "react";
import type { SignalClass } from "@/api/types";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";

interface ClassStyle {
  label: string;
  icon: ReactNode;
  className: string;
}

/**
 * Classification vocabulary. We deliberately say "planet-like" / "false-positive-like": a model
 * output describes how a signal *looks*, it does not confirm a planet.
 */
export const CLASS_STYLES: Record<SignalClass, ClassStyle> = {
  planet: {
    label: "Planet-like",
    icon: <Orbit aria-hidden="true" />,
    className: "border-signal-planet/40 bg-signal-planet/10 text-signal-planet",
  },
  false_positive: {
    label: "False-positive-like",
    icon: <CircleSlash2 aria-hidden="true" />,
    className: "border-signal-fp/40 bg-signal-fp/10 text-signal-fp",
  },
  uncertain: {
    label: "Uncertain",
    icon: <CircleHelp aria-hidden="true" />,
    className: "border-signal-uncertain/40 bg-signal-uncertain/10 text-signal-uncertain",
  },
};

/** Map a binary label (1 = planet-like, 0 = false-positive-like, null = unknown) to a class. */
export function classFromLabel(label: 0 | 1 | null | undefined): SignalClass {
  if (label === 1) return "planet";
  if (label === 0) return "false_positive";
  return "uncertain";
}

export interface ClassBadgeProps {
  cls: SignalClass;
  /** Optional probability appended in mono, e.g. "· 0.873". */
  probability?: number | null;
  size?: "sm" | "md";
  /** Prefix for screen readers, e.g. "Model verdict" or "Catalogue label". */
  context?: string;
  className?: string;
}

/** Signal class shown as icon + text (never colour alone). */
export function ClassBadge({ cls, probability, size = "sm", context, className }: ClassBadgeProps) {
  const s = CLASS_STYLES[cls];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium [&_svg]:shrink-0",
        size === "sm" ? "h-6 px-2 text-xs [&_svg]:size-3.5" : "h-8 px-3 text-base [&_svg]:size-4",
        s.className,
        className,
      )}
      data-class={cls}
    >
      {s.icon}
      {context ? <span className="sr-only">{context}: </span> : null}
      <span>{s.label}</span>
      {probability !== undefined && probability !== null ? (
        <span className="num opacity-90">· {formatProbability(probability)}</span>
      ) : null}
    </span>
  );
}
