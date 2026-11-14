/** Shared chart furniture: legend with line-style swatches and a Recharts tooltip card. */
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { DASHARRAY, type Dash } from "./theme";

export interface LegendItem {
  key: string;
  label: ReactNode;
  color: string;
  dash?: Dash;
  /** Optional value (e.g. "AUC 0.962") in mono after the label. */
  value?: ReactNode;
  marker?: "line" | "dot" | "square" | "swatch";
  /** Fill for the "swatch" marker (e.g. `patternFill(color, dash)` for textured bars). */
  fill?: CSSProperties;
}

/** HTML legend — the swatch shows colour AND dash pattern so identity never relies on colour. */
export function ChartLegend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-secondary", className)}>
      {items.map((it) => (
        <li key={it.key} className="flex items-center gap-1.5">
          {it.marker === "dot" ? (
            <span className="size-2 rounded-full" style={{ background: it.color }} aria-hidden="true" />
          ) : it.marker === "square" ? (
            <span className="size-2.5 rounded-[2px]" style={{ background: it.color }} aria-hidden="true" />
          ) : it.marker === "swatch" ? (
            <span className="h-2.5 w-5 rounded-[2px]" style={it.fill ?? { background: it.color }} aria-hidden="true" />
          ) : (
            <svg width="22" height="8" aria-hidden="true">
              <line x1="1" x2="21" y1="4" y2="4" stroke={it.color} strokeWidth="2" strokeLinecap="round" strokeDasharray={DASHARRAY[it.dash ?? "solid"]} />
            </svg>
          )}
          <span className="text-fg">{it.label}</span>
          {it.value !== undefined ? <span className="num text-fg-secondary">{it.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export interface TooltipRow {
  key: string;
  label: ReactNode;
  value: ReactNode;
  color?: string;
}

/** Tooltip card body used by Recharts `content` renderers. */
export function ChartTooltipCard({ title, rows }: { title?: ReactNode; rows: TooltipRow[] }) {
  return (
    <div className="min-w-[160px] rounded-md border border-hairline-strong bg-surface-raised px-3 py-2 text-xs shadow-[0_8px_24px_-6px_rgb(0_0_0/0.6)]">
      {title ? <div className="num mb-1.5 text-fg-secondary">{title}</div> : null}
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-fg-secondary">
              {r.color ? <span className="size-2 rounded-full" style={{ background: r.color }} aria-hidden="true" /> : null}
              {r.label}
            </span>
            <span className="num text-fg">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
