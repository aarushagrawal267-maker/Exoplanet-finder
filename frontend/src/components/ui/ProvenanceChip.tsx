import { Calculator, Cpu, Library, PencilLine, Ruler } from "lucide-react";
import type { ReactNode } from "react";
import type { Provenance } from "@/api/types";
import { cn } from "@/lib/cn";

interface ProvenanceStyle {
  label: string;
  description: string;
  icon: ReactNode;
  className: string;
}

/**
 * Visual language for where a number came from. Each kind has a distinct border treatment AND a
 * text label, so provenance is never conveyed by colour alone:
 *  - catalogue: published NASA Exoplanet Archive value (outlined blue)
 *  - measured:  computed by this app's pipeline from the light curve (outlined teal)
 *  - estimate:  derived with assumptions, e.g. radius from depth × R★ (dashed)
 *  - model:     output of a trained classifier (violet)
 *  - manual:    entered by the user (grey)
 */
export const PROVENANCE: Record<Provenance, ProvenanceStyle> = {
  catalogue: {
    label: "Catalogue",
    description: "Published value from the NASA Exoplanet Archive",
    icon: <Library aria-hidden="true" />,
    className: "border-cosmic/60 text-cosmic",
  },
  measured: {
    label: "Measured",
    description: "Measured by this app's pipeline from the light curve",
    icon: <Ruler aria-hidden="true" />,
    className: "border-signal-planet/60 text-signal-planet",
  },
  estimate: {
    label: "Estimate",
    description: "Derived estimate that depends on stated assumptions",
    icon: <Calculator aria-hidden="true" />,
    className: "border-dashed border-signal-uncertain/80 text-signal-uncertain",
  },
  model: {
    label: "Model",
    description: "Output of a machine-learning model trained in this app",
    icon: <Cpu aria-hidden="true" />,
    className: "border-nebula/50 bg-nebula/10 text-nebula",
  },
  manual: {
    label: "Manual",
    description: "Entered manually by the user",
    icon: <PencilLine aria-hidden="true" />,
    className: "border-fg-muted text-fg-secondary",
  },
};

export interface ProvenanceChipProps {
  kind: Provenance;
  /** Override the label text (keep it short). */
  label?: string;
  /** Specific source, e.g. "KOI cumulative · 2026-11-14"; shown as a native tooltip. */
  source?: string;
  size?: "sm" | "xs";
  className?: string;
}

export function ProvenanceChip({ kind, label, source, size = "sm", className }: ProvenanceChipProps) {
  const p = PROVENANCE[kind];
  const text = label ?? p.label;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-sm border font-mono uppercase tracking-[0.08em] [&_svg]:shrink-0",
        size === "sm" ? "h-5 px-1.5 text-2xs [&_svg]:size-3" : "h-4 px-1 text-[10px] leading-3 [&_svg]:size-2.5",
        p.className,
        className,
      )}
      title={source ? `${p.description} — ${source}` : p.description}
      data-provenance={kind}
    >
      {p.icon}
      {text}
      {source ? <span className="sr-only">: {source}</span> : null}
    </span>
  );
}
