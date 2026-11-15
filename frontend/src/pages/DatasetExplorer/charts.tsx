/**
 * Dataset statistics charts: class balance per split, quality-grade distribution and the
 * log-scaled period / depth histograms per class. Class colours (teal planet-like, amber
 * false-positive-like) are used only for class meaning and always come with text labels.
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DatasetHistogram, SplitCounts } from "@/api/schemasOps";
import type { QualityGrade } from "@/api/types";
import { ChartLegend, ChartTooltipCard } from "@/components/charts/ChartParts";
import { chartColors, rcAxis, rcGrid } from "@/components/charts/theme";
import { GradeMark } from "@/components/science/GradeMark";
import { GRADE_INFO } from "@/components/science/verdict";
import { cn } from "@/lib/cn";
import { formatInt, formatNumber, formatPercent } from "@/lib/format";
import { SPLIT_LABEL } from "../_ops/metrics";

const PLANET = chartColors.planet;
const FP = chartColors.fp;

// ------------------------------------------------------------------------------------------------
export function ClassBalance({ perSplit, className }: { perSplit: Record<string, SplitCounts>; className?: string }) {
  const order = ["train", "val", "test"].filter((s) => perSplit[s]);
  const max = Math.max(1, ...order.map((s) => perSplit[s]?.n ?? 0));
  return (
    <figure className={cn("m-0 flex flex-col gap-3", className)} aria-label="Class balance per split">
      <ul className="flex flex-col gap-2.5">
        {order.map((s) => {
          const c = perSplit[s] as SplitCounts;
          const posW = (c.n_pos / max) * 100;
          const negW = (c.n_neg / max) * 100;
          return (
            <li key={s} className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-3 text-sm sm:grid-cols-[88px_minmax(0,1fr)_200px]">
              <span className="text-fg-secondary">{SPLIT_LABEL[s] ?? s}</span>
              <span className="flex h-3 overflow-hidden rounded-sm bg-hairline/60" aria-hidden="true">
                <span className="h-full" style={{ width: `${posW}%`, background: PLANET }} />
                <span className="h-full border-l border-void" style={{ width: `${negW}%`, background: FP, opacity: 0.85 }} />
              </span>
              <span className="num col-span-2 text-xs text-fg-secondary sm:col-span-1 sm:text-right">
                <span className="text-fg">{formatInt(c.n_pos)}</span> / <span className="text-fg">{formatInt(c.n_neg)}</span> ·{" "}
                {formatPercent(c.n ? c.n_pos / c.n : null, { digits: 0 })} planet-like
              </span>
            </li>
          );
        })}
      </ul>
      <ChartLegend
        items={[
          { key: "pos", label: "Planet-like (label 1)", color: PLANET, marker: "square" },
          { key: "neg", label: "False-positive-like (label 0)", color: FP, marker: "square" },
        ]}
      />
    </figure>
  );
}

// ------------------------------------------------------------------------------------------------
const GRADES: QualityGrade[] = ["A", "B", "C", "D"];

export function GradeDistribution({ grades, className }: { grades: Record<string, number>; className?: string }) {
  const total = GRADES.reduce((s, g) => s + (grades[g] ?? 0), 0);
  const max = Math.max(1, ...GRADES.map((g) => grades[g] ?? 0));
  return (
    <ul className={cn("flex flex-col gap-2", className)} aria-label="Data-quality grades of the processed signals">
      {GRADES.map((g) => {
        const n = grades[g] ?? 0;
        return (
          <li key={g} className="grid grid-cols-[28px_minmax(0,1fr)_92px] items-center gap-3 text-sm">
            <GradeMark grade={g} size="sm" />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-xs text-fg-secondary" title={GRADE_INFO[g].description}>{GRADE_INFO[g].description}</span>
              <span className="h-1.5 rounded-full bg-hairline" aria-hidden="true">
                <span className="block h-full rounded-full bg-cosmic" style={{ width: `${(n / max) * 100}%` }} />
              </span>
            </span>
            <span className="num text-right text-fg">
              {formatInt(n)} <span className="text-xs text-fg-secondary">{formatPercent(total ? n / total : null, { digits: 0 })}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------------------------------------
/** Label for 10^log10: "0.001", "0.5", "3.2", "100", "10,000" (+ unit). */
export function tickLabel(log10: number, unit: string): string {
  const v = 10 ** log10;
  const digits = v >= 10 ? 0 : v >= 1 ? 1 : Math.min(6, Math.max(1, -Math.floor(Math.log10(v)) + (Number.isInteger(log10) ? 0 : 1)));
  const s = v >= 10 ? formatInt(v) : formatNumber(v, { digits });
  return unit ? `${s} ${unit}` : s;
}

/** Powers of ten inside [min, max]; every second one when there are more than five. */
export function decadeTicks(min: number, max: number): number[] {
  const ticks: number[] = [];
  for (let t = Math.ceil(min) || 0; t <= Math.floor(max); t += 1) ticks.push(t); // `|| 0`: no −0
  return ticks.length > 5 ? ticks.filter((_, i) => i % 2 === 0) : ticks;
}

export interface LogHistogramProps {
  hist: DatasetHistogram;
  title: string;
  /** Unit of the underlying (non-log) value, e.g. "d" or "ppm". */
  unit: string;
  height?: number;
  className?: string;
}

/** Histogram of log10(value) per class on shared bin edges; axis ticks at powers of ten. */
export function LogHistogram({ hist, title, unit, height = 200, className }: LogHistogramProps) {
  const edges = hist.log10_edges;
  const pos = hist.counts.planet_like ?? [];
  const neg = hist.counts.false_positive_like ?? [];
  const rows = edges.slice(0, -1).map((lo, i) => ({
    x: (lo + (edges[i + 1] ?? lo)) / 2,
    lo,
    hi: edges[i + 1] ?? lo,
    planet: pos[i] ?? 0,
    fp: neg[i] ?? 0,
  }));
  const min = edges[0] ?? 0;
  const max = edges[edges.length - 1] ?? 1;
  const ticks = decadeTicks(min, max);
  const nPos = pos.reduce((a, b) => a + b, 0);
  const nNeg = neg.reduce((a, b) => a + b, 0);
  return (
    <figure className={cn("m-0 min-w-0", className)} aria-label={`${title} histogram (log scale): ${nPos} planet-like and ${nNeg} false-positive-like signals`}>
      <div className="eyebrow mb-2 text-fg-secondary">{title}</div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 12, bottom: 20, left: 0 }} barGap={0} barCategoryGap={1}>
            <CartesianGrid {...rcGrid} />
            <XAxis
              dataKey="x"
              type="number"
              scale="linear"
              domain={[min, max]}
              ticks={ticks.length >= 2 ? ticks : undefined}
              tickFormatter={(v: number) => tickLabel(v, unit)}
              {...rcAxis}
              label={{ value: `${title} (log scale)`, position: "insideBottom", offset: -12, fill: chartColors.title, fontSize: 12 }}
            />
            <YAxis width={40} allowDecimals={false} {...rcAxis} />
            <Tooltip
              isAnimationActive={false}
              cursor={{ fill: "rgba(154,166,196,0.08)" }}
              content={({ active, payload }) => {
                const r = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                if (!active || !r) return null;
                return (
                  <ChartTooltipCard
                    title={`${tickLabel(r.lo, unit)} – ${tickLabel(r.hi, unit)}`}
                    rows={[
                      { key: "p", label: "Planet-like", color: PLANET, value: formatInt(r.planet) },
                      { key: "f", label: "False-positive-like", color: FP, value: formatInt(r.fp) },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="planet" name="Planet-like" fill={PLANET} isAnimationActive={false} />
            <Bar dataKey="fp" name="False-positive-like" fill={FP} fillOpacity={0.85} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
