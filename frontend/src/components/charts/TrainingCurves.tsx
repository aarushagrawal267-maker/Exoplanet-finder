/**
 * TrainingCurves — per-epoch loss (train vs validation) and validation PR-AUC.
 *
 * Built for live updates: pass the growing `history` array as epochs stream in over SSE. The
 * x domain is fixed to [1, maxEpochs] so the axes don't jump on every append, and animation is
 * off. Two charts instead of one dual-axis chart, because loss and PR-AUC have different scales.
 * The best epoch (early-stopping checkpoint) is marked on both.
 */
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { ChartLegend, ChartTooltipCard } from "./ChartParts";
import { chartColors, MONO, rcAxis, rcGrid } from "./theme";

export interface EpochPoint {
  epoch: number;
  train_loss?: number | null;
  val_loss?: number | null;
  val_pr_auc?: number | null;
  val_roc_auc?: number | null;
}

export interface TrainingCurvesProps {
  history: EpochPoint[];
  bestEpoch?: number | null;
  maxEpochs?: number;
  height?: number;
  className?: string;
}

/** Epoch ticks on a round step (1, 10, 20 … for 50 epochs). */
export function epochTicks(xMax: number): number[] {
  const raw = xMax / 5;
  const mag = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks = [1];
  for (let t = step; t <= xMax; t += step) if (t > 1) ticks.push(t);
  return ticks;
}

const TRAIN = chartColors.tick;
const VAL = chartColors.binned;

function BestLine({ epoch }: { epoch?: number | null }) {
  if (epoch === undefined || epoch === null) return null;
  return (
    <ReferenceLine
      x={epoch}
      stroke={chartColors.model}
      strokeDasharray="3 3"
      label={{ value: "best", position: "insideBottomRight", fill: chartColors.model, fontSize: 10, fontFamily: MONO }}
    />
  );
}

export function TrainingCurves({ history, bestEpoch, maxEpochs, height = 220, className }: TrainingCurvesProps) {
  const lastEpoch = history.length ? (history[history.length - 1] as EpochPoint).epoch : 1;
  const xMax = Math.max(maxEpochs ?? lastEpoch, lastEpoch, 2);
  const xAxis = (
    <XAxis
      dataKey="epoch"
      type="number"
      domain={[1, xMax]}
      ticks={epochTicks(xMax)}
      allowDecimals={false}
      {...rcAxis}
      label={{ value: "Epoch", position: "insideBottom", offset: -12, fill: chartColors.title, fontSize: 12 }}
    />
  );
  const tooltip = (
    <Tooltip
      isAnimationActive={false}
      cursor={{ stroke: chartColors.axis }}
      content={({ active, payload, label }) =>
        active && payload?.length ? (
          <ChartTooltipCard
            title={`epoch ${label}`}
            rows={payload.map((p, i) => ({ key: `${p.name}-${i}`, label: p.name, color: p.color, value: formatNumber(Number(p.value), { digits: 4 }) }))}
          />
        ) : null
      }
    />
  );

  return (
    <div className={cn("grid grid-cols-1 gap-6 md:grid-cols-2", className)}>
      <figure className="m-0 min-w-0" aria-label="Training and validation loss by epoch">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="eyebrow text-fg-secondary">Loss (BCE)</span>
          <ChartLegend
            items={[
              { key: "train", label: "Train", color: TRAIN, dash: "solid" },
              { key: "val", label: "Validation", color: VAL, dash: "dash" },
            ]}
          />
        </div>
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 8, right: 12, bottom: 20, left: 4 }}>
              <CartesianGrid {...rcGrid} />
              {xAxis}
              <YAxis width={48} {...rcAxis} tickFormatter={(v: number) => formatNumber(v, { digits: 2 })} domain={["auto", "auto"]} />
              {tooltip}
              <BestLine epoch={bestEpoch} />
              <Line dataKey="train_loss" name="Train loss" stroke={TRAIN} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="val_loss" name="Val loss" stroke={VAL} strokeWidth={2} strokeDasharray="7 4" dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <figure className="m-0 min-w-0" aria-label="Validation precision–recall AUC by epoch">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="eyebrow text-fg-secondary">Validation PR-AUC</span>
          <ChartLegend items={[{ key: "prauc", label: "PR-AUC", color: VAL, dash: "solid" }]} />
        </div>
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 8, right: 12, bottom: 20, left: 4 }}>
              <CartesianGrid {...rcGrid} />
              {xAxis}
              <YAxis width={48} {...rcAxis} domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v: number) => formatNumber(v, { digits: 2 })} />
              {tooltip}
              <BestLine epoch={bestEpoch} />
              <Line dataKey="val_pr_auc" name="Val PR-AUC" stroke={VAL} strokeWidth={2} dot={{ r: 2.5, fill: VAL, strokeWidth: 0 }} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </div>
  );
}
