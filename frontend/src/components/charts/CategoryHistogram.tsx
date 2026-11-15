/**
 * CategoryHistogram — distribution of one catalogue quantity (period, depth, SNR) per catalogue
 * category, on a log10 axis with shared bin edges (`/api/catalog/stats` histograms).
 *
 * Form: overlaid step outlines (one per category) rather than stacked bars, because the job is to
 * compare *shapes* between categories of very different sizes; "share" mode normalises each
 * category to 100 % so a 2,000-signal category is as readable as a 14,000-signal one. Category
 * identity uses the validated SERIES_PALETTE in fixed order with a distinct dash per series and a
 * legend, so it never relies on colour alone. Sparse outlier tails (the outer 0.4 %) are cropped and
 * reported under the chart, not silently dropped.
 */
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistogramOut } from "@/api/schemas";
import { cn } from "@/lib/cn";
import { formatInt, formatNumber, formatPercent } from "@/lib/format";
import { ChartLegend, ChartTooltipCard } from "./ChartParts";
import { DASHARRAY, rcAxis, rcGrid, SERIES_DASH, SERIES_PALETTE } from "./theme";

export interface CategoryHistogramProps {
  histogram: HistogramOut;
  /** Category keys in fixed order (colour follows the category, never its rank). */
  categories: readonly string[];
  categoryLabel: (key: string) => string;
  mode?: "count" | "share";
  height?: number;
  className?: string;
}

/** 10^x tick text for a log10 axis: 0.1, 1, 10, 1,000, 1e+6. */
export function pow10Label(x: number): string {
  const v = 10 ** x;
  if (v >= 1e6 || v < 1e-3) return v.toExponential(0).replace("e+", "e");
  return formatNumber(v, { digits: v < 1 ? (v < 0.01 ? 3 : v < 0.1 ? 2 : 1) : 0 });
}

/** Indices [lo, hi] of the bins holding the central part of all signals (`tail` cut from each side). */
export function centralRange(totals: number[], tail = 0.001): [number, number] {
  const sum = totals.reduce((a, b) => a + b, 0);
  if (sum === 0) return [0, Math.max(0, totals.length - 1)];
  let lo = 0;
  let acc = 0;
  while (lo < totals.length - 1 && acc + (totals[lo] ?? 0) <= sum * tail) acc += totals[lo++] ?? 0;
  let hi = totals.length - 1;
  acc = 0;
  while (hi > lo && acc + (totals[hi] ?? 0) <= sum * tail) acc += totals[hi--] ?? 0;
  return [lo, hi];
}

export function CategoryHistogram({ histogram, categories, categoryLabel, mode = "count", height = 220, className }: CategoryHistogramProps) {
  const { rows, ticks, outside, range } = useMemo(() => {
    const e = histogram.edges;
    const nBins = Math.max(0, e.length - 1);
    const totals = Array.from({ length: nBins }, (_, i) => categories.reduce((s, c) => s + (histogram.counts[c]?.[i] ?? 0), 0));
    const [lo, hi] = centralRange(totals, 0.004);
    const perCat = Object.fromEntries(categories.map((c) => [c, (histogram.counts[c] ?? []).reduce((a, b) => a + b, 0)]));
    const out: Array<Record<string, number>> = [];
    for (let i = lo; i <= hi; i += 1) {
      const row: Record<string, number> = { x: ((e[i] as number) + (e[i + 1] as number)) / 2, lo: e[i] as number, hi: e[i + 1] as number };
      for (const c of categories) {
        const n = histogram.counts[c]?.[i] ?? 0;
        row[c] = mode === "share" ? (perCat[c] ? n / (perCat[c] as number) : 0) : n;
        row[`${c}__n`] = n;
      }
      out.push(row);
    }
    const x0 = e[lo] ?? 0;
    const x1 = e[hi + 1] ?? 1;
    // Powers of ten, thinned to at most ~5 ticks so labels never collide on narrow cards.
    const t: number[] = [];
    const first = Math.ceil(x0);
    const last = Math.floor(x1);
    const step = Math.max(1, Math.ceil((last - first + 1) / 5));
    for (let k = first; k <= last; k += step) t.push(k);
    const outsideCount = totals.slice(0, lo).reduce((a, b) => a + b, 0) + totals.slice(hi + 1).reduce((a, b) => a + b, 0);
    return { rows: out, ticks: t, outside: outsideCount, range: [x0, x1] as [number, number] };
  }, [histogram, categories, mode]);

  const unitLabel = histogram.unit.replace(/^log10\((.*)\)$/, "$1");
  const styles = categories.map((c, i) => ({ key: c, color: SERIES_PALETTE[i % SERIES_PALETTE.length] as string, dash: SERIES_DASH[i % SERIES_DASH.length] ?? "solid" }));
  const missing = categories.reduce((s, c) => s + (histogram.n_missing[c] ?? 0), 0);

  return (
    <figure className={cn("m-0 flex min-w-0 flex-col gap-2", className)} aria-label={`Histogram of ${histogram.label} by catalogue category (${mode === "share" ? "share of each category" : "counts"})`}>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 22, bottom: 20, left: 0 }}>
            <CartesianGrid {...rcGrid} />
            <XAxis
              dataKey="x"
              type="number"
              domain={range}
              ticks={ticks}
              tickFormatter={pow10Label}
              {...rcAxis}
              label={{ value: unitLabel, position: "insideBottom", offset: -12, fill: rcAxis.tick.fill, fontSize: 11 }}
            />
            <YAxis
              {...rcAxis}
              width={48}
              tickFormatter={(v: number) => (mode === "share" ? formatPercent(v, { digits: 0 }) : formatInt(v))}
              allowDecimals={mode === "share"}
            />
            <Tooltip
              cursor={{ stroke: rcAxis.stroke, strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as Record<string, number> | undefined;
                if (!active || !row) return null;
                return (
                  <ChartTooltipCard
                    title={`${pow10Label(row.lo as number)} – ${pow10Label(row.hi as number)} ${unitLabel}`}
                    rows={styles.map((s) => ({
                      key: s.key,
                      label: categoryLabel(s.key),
                      color: s.color,
                      value: mode === "share" ? `${formatPercent(row[s.key], { digits: 1 })} (${formatInt(row[`${s.key}__n`])})` : formatInt(row[`${s.key}__n`]),
                    }))}
                  />
                );
              }}
            />
            {styles.map((s) => (
              <Line
                key={s.key}
                type="step"
                dataKey={s.key}
                name={categoryLabel(s.key)}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={DASHARRAY[s.dash]}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--c-surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={styles.map((s) => ({ key: s.key, label: categoryLabel(s.key), color: s.color, dash: s.dash }))} />
      {outside > 0 || missing > 0 ? (
        <figcaption className="text-xs text-fg-secondary">
          {outside > 0 ? (
            <>
              <span className="num">{formatInt(outside)}</span> outlier{outside === 1 ? "" : "s"} outside {pow10Label(range[0])}–{pow10Label(range[1])} {unitLabel} not drawn.{" "}
            </>
          ) : null}
          {missing > 0 ? (
            <>
              <span className="num">{formatInt(missing)}</span> signal{missing === 1 ? "" : "s"} without a positive value.
            </>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
