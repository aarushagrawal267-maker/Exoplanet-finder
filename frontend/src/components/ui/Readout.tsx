import type { ReactNode } from "react";
import type { Provenance } from "@/api/types";
import { cn } from "@/lib/cn";
import { ProvenanceChip } from "./ProvenanceChip";

export type ReadoutTone = "default" | "planet" | "fp" | "model" | "cosmic" | "warn" | "danger";

const toneText: Record<ReadoutTone, string> = {
  default: "text-fg",
  planet: "text-signal-planet",
  fp: "text-signal-fp",
  model: "text-nebula",
  cosmic: "text-cosmic",
  warn: "text-warn",
  danger: "text-danger",
};

const valueSize = { sm: "text-lg", md: "text-xl", lg: "text-2xl" } as const;

export interface ReadoutProps {
  /** Eyebrow label, e.g. "Orbital period". */
  label: ReactNode;
  /** Pre-formatted value (use lib/format). Rendered in mono tabular numerals. */
  value: ReactNode;
  unit?: ReactNode;
  /** Uncertainty, rendered as "± err" next to the value. */
  error?: ReactNode;
  provenance?: Provenance;
  provenanceSource?: string;
  /** Small caption under the value. */
  caption?: ReactNode;
  size?: "sm" | "md" | "lg";
  tone?: ReadoutTone;
  className?: string;
}

/**
 * A big mono number with unit and label — the instrument-panel readout used for every headline
 * quantity (period, depth, SNR, probability…).
 */
export function Readout({
  label,
  value,
  unit,
  error,
  provenance,
  provenanceSource,
  caption,
  size = "md",
  tone = "default",
  className,
}: ReadoutProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="eyebrow text-fg-secondary">{label}</span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <span className={cn("num font-medium leading-none tracking-tight", valueSize[size], toneText[tone])}>{value}</span>
        {/* "± err unit" wraps as one unit: a lone "ppm" on its own line reads as a new value. */}
        {error || unit ? (
          <span className="num whitespace-nowrap text-sm text-fg-secondary">
            {error ? <>± {error}</> : null}
            {error && unit ? " " : null}
            {unit}
          </span>
        ) : null}
      </div>
      {provenance || caption ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {provenance ? <ProvenanceChip kind={provenance} source={provenanceSource} size="xs" /> : null}
          {caption ? <span className="text-xs text-fg-secondary">{caption}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Alias: "Stat" is the dashboard-facing name of the same component. */
export const Stat = Readout;
export type StatProps = ReadoutProps;
