/**
 * MetricBars — compare headline metrics (PR-AUC, ROC-AUC, F1, recall…) across models.
 *
 * Horizontal bars on a shared 0–1 scale, one row group per metric. Optional bootstrap 95 %
 * confidence intervals are drawn as whiskers; overlapping intervals mean the difference between
 * two models is not resolved by the test set. Values are always printed, and each model's bars
 * carry the texture of its series slot (flat, hatched, dotted…) as well as its colour, so model
 * identity never rests on colour alone.
 */
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { ChartLegend } from "./ChartParts";
import { patternFill, seriesStyle } from "./theme";

export interface MetricBarValue {
  modelId: string;
  value: number | null;
  ci?: [number, number] | null;
}

export interface MetricBarGroup {
  metric: string;
  /** Short help text, e.g. "area under the precision–recall curve". */
  help?: string;
  values: MetricBarValue[];
}

export interface MetricBarsProps {
  models: Array<{ id: string; label: string; modelType?: string }>;
  groups: MetricBarGroup[];
  digits?: number;
  className?: string;
}

export function MetricBars({ models, groups, digits = 3, className }: MetricBarsProps) {
  const styleOf = new Map(models.map((m, i) => [m.id, { ...seriesStyle(m.modelType, i), label: m.label }]));
  return (
    <figure className={cn("m-0 flex flex-col gap-5", className)} aria-label={`Metric comparison across ${models.length} models`}>
      {groups.map((g) => (
        <div key={g.metric} className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4">
          <div>
            <div className="text-sm font-medium text-fg">{g.metric}</div>
            {g.help ? <div className="text-xs text-fg-secondary">{g.help}</div> : null}
          </div>
          <ul className="flex flex-col gap-1.5">
            {g.values.map((v) => {
              const s = styleOf.get(v.modelId);
              const pct = v.value === null ? 0 : Math.max(0, Math.min(1, v.value)) * 100;
              return (
                <li key={v.modelId} className="grid grid-cols-[1fr_64px] items-center gap-3">
                  <div className="relative h-3 rounded-sm bg-hairline/60" aria-hidden="true">
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm opacity-90"
                      style={{ width: `${pct}%`, ...(s ? patternFill(s.color, s.dash) : null) }}
                      data-testid="metric-bar"
                    />
                    {v.ci ? (
                      <div
                        className="absolute top-1/2 h-px -translate-y-1/2 bg-fg"
                        style={{ left: `${v.ci[0] * 100}%`, width: `${Math.max(0, v.ci[1] - v.ci[0]) * 100}%` }}
                      >
                        <span className="absolute -top-1 left-0 h-[9px] w-px bg-fg" />
                        <span className="absolute -top-1 right-0 h-[9px] w-px bg-fg" />
                      </div>
                    ) : null}
                  </div>
                  <span className="num text-right text-sm text-fg">
                    <span className="sr-only">{s?.label}: </span>
                    {formatNumber(v.value, { digits })}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <ChartLegend
        className="sm:pl-[156px]"
        items={models.map((m, i) => {
          const s = seriesStyle(m.modelType, i);
          return { key: m.id, label: m.label, color: s.color, marker: "swatch" as const, fill: patternFill(s.color, s.dash) };
        })}
      />
    </figure>
  );
}
