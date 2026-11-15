/**
 * CalibrationChart — reliability diagram.
 *
 * Predictions are grouped into probability bins; for each bin we plot the mean predicted
 * probability (x) against the observed fraction of class-1 examples (y). A perfectly calibrated
 * model lies on the diagonal: of the signals scored ~0.8, ~80 % really are planet-like. Points
 * below the diagonal mean over-confidence. Bin counts are shown in a separate strip beneath
 * (never on a second y axis), because sparse bins are noisy.
 */
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/cn";
import { formatInt, formatNumber } from "@/lib/format";
import { ChartLegend, ChartTooltipCard } from "./ChartParts";
import { chartColors, DASHARRAY, rcAxis, rcGrid, seriesStyle, withAlpha } from "./theme";

export interface ReliabilityBin {
  bin_lo: number;
  bin_hi: number;
  mean_pred: number | null;
  frac_pos: number | null;
  count: number;
}

export interface CalibrationSeries {
  id: string;
  label: string;
  modelType?: string;
  bins: ReliabilityBin[];
  ece?: number | null;
}

export interface CalibrationChartProps {
  series: CalibrationSeries[];
  height?: number;
  className?: string;
}

const TICKS = [0, 0.2, 0.4, 0.6, 0.8, 1];

export function CalibrationChart({ series, height = 260, className }: CalibrationChartProps) {
  const first = series[0];
  const counts = first ? first.bins.map((b) => ({ mid: (b.bin_lo + b.bin_hi) / 2, count: b.count })) : [];
  return (
    <figure className={cn("m-0 flex flex-col gap-3", className)} aria-label="Reliability diagram: observed planet-like fraction versus mean predicted probability">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
            <CartesianGrid {...rcGrid} vertical />
            <XAxis dataKey="mean_pred" type="number" domain={[0, 1]} ticks={TICKS} allowDuplicatedCategory={false} {...rcAxis} />
            <YAxis
              type="number"
              domain={[0, 1]}
              ticks={TICKS}
              width={60}
              {...rcAxis}
              label={{ value: "Observed fraction class 1", angle: -90, position: "insideLeft", offset: 4, fill: chartColors.title, fontSize: 12, style: { textAnchor: "middle" } }}
            />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={chartColors.reference} strokeDasharray="2 4" />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: chartColors.axis }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const b = payload[0]?.payload as ReliabilityBin | undefined;
                return (
                  <ChartTooltipCard
                    title={b ? `bin ${formatNumber(b.bin_lo, { digits: 1 })}–${formatNumber(b.bin_hi, { digits: 1 })}` : undefined}
                    rows={payload.map((p, i) => {
                      const pb = p.payload as ReliabilityBin;
                      return {
                        key: `${p.name}-${i}`,
                        label: p.name,
                        color: p.color,
                        value: `${formatNumber(pb.frac_pos, { digits: 2 })} obs · n=${formatInt(pb.count)}`,
                      };
                    })}
                  />
                );
              }}
            />
            {series.map((s, i) => {
              const st = seriesStyle(s.modelType, i);
              return (
                <Line
                  key={s.id}
                  data={s.bins.filter((b) => b.mean_pred !== null && b.frac_pos !== null && b.count > 0)}
                  dataKey="frac_pos"
                  name={s.label}
                  stroke={st.color}
                  strokeWidth={2}
                  strokeDasharray={DASHARRAY[st.dash]}
                  dot={{ r: 4, fill: st.color, stroke: chartColors.surface, strokeWidth: 2, strokeDasharray: "0" }}
                  activeDot={{ r: 5, strokeDasharray: "0" }}
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {counts.length ? (
        <div>
          <div className="eyebrow mb-1 pl-16 text-fg-secondary">Examples per bin{series.length > 1 ? ` · ${first?.label}` : ""}</div>
          <div style={{ height: 64 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={counts} margin={{ top: 2, right: 12, bottom: 18, left: 4 }} barCategoryGap={2}>
                <XAxis
                  dataKey="mid"
                  type="number"
                  domain={[0, 1]}
                  ticks={TICKS}
                  {...rcAxis}
                  label={{ value: "Mean predicted probability", position: "insideBottom", offset: -12, fill: chartColors.title, fontSize: 12 }}
                />
                <YAxis width={60} {...rcAxis} tickCount={2} allowDecimals={false} />
                <Bar dataKey="count" fill={withAlpha(chartColors.tick, 0.35)} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
      {series.length > 1 || series.some((s) => s.ece !== undefined) ? (
        <ChartLegend
          items={series.map((s, i) => {
            const st = seriesStyle(s.modelType, i);
            return {
              key: s.id,
              label: s.label,
              color: st.color,
              dash: st.dash,
              value: s.ece !== undefined && s.ece !== null ? `ECE ${formatNumber(s.ece, { digits: 3 })}` : undefined,
            };
          })}
        />
      ) : null}
    </figure>
  );
}
