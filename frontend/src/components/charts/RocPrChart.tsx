/**
 * RocPrChart — ROC and precision–recall curves for one or several models on the same split.
 *
 * - ROC: true-positive rate vs false-positive rate; the dotted diagonal is a random classifier.
 * - PR: precision vs recall; the dotted horizontal line is the positive-class prevalence, i.e. what
 *   a random classifier achieves. PR is the more honest view when classes are imbalanced (as Kepler
 *   TCEs are), which is why training selects on validation PR-AUC.
 * Each model keeps a fixed colour + dash from MODEL_PALETTE.
 */
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ChartLegend, ChartTooltipCard } from "./ChartParts";
import { chartColors, DASHARRAY, MONO, rcAxis, rcGrid, seriesStyle } from "./theme";

export interface CurveModel {
  id: string;
  label: string;
  modelType?: string;
  roc?: Array<{ fpr: number; tpr: number }>;
  pr?: Array<{ recall: number; precision: number }>;
  rocAuc?: number | null;
  prAuc?: number | null;
}

export interface RocPrChartProps {
  models: CurveModel[];
  mode?: "roc" | "pr" | "both";
  /** Positive-class fraction of the evaluated split (PR chance level). */
  prevalence?: number | null;
  height?: number;
  className?: string;
}

const TICKS = [0, 0.25, 0.5, 0.75, 1];

function CurvePanel({
  kind,
  models,
  prevalence,
  height,
}: {
  kind: "roc" | "pr";
  models: CurveModel[];
  prevalence?: number | null;
  height: number;
}) {
  const xKey = kind === "roc" ? "fpr" : "recall";
  const yKey = kind === "roc" ? "tpr" : "precision";
  const xLabel = kind === "roc" ? "False-positive rate" : "Recall";
  const yLabel = kind === "roc" ? "True-positive rate" : "Precision";
  return (
    <figure className="m-0 min-w-0 flex-1" aria-label={`${kind === "roc" ? "ROC" : "Precision–recall"} curves for ${models.map((m) => m.label).join(", ")}`}>
      <div className="eyebrow mb-2 text-fg-secondary">{kind === "roc" ? "ROC curve" : "Precision–recall"}</div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 8, right: 12, bottom: 24, left: 4 }}>
            <CartesianGrid {...rcGrid} vertical />
            <XAxis
              dataKey={xKey}
              type="number"
              domain={[0, 1]}
              ticks={TICKS}
              allowDuplicatedCategory={false}
              {...rcAxis}
              label={{ value: xLabel, position: "insideBottom", offset: -14, fill: chartColors.title, fontSize: 12 }}
            />
            <YAxis
              type="number"
              domain={[0, 1]}
              ticks={TICKS}
              width={60}
              {...rcAxis}
              label={{ value: yLabel, angle: -90, position: "insideLeft", offset: 4, fill: chartColors.title, fontSize: 12, style: { textAnchor: "middle" } }}
            />
            {kind === "roc" ? (
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={chartColors.reference} strokeDasharray="2 4" ifOverflow="hidden" />
            ) : prevalence !== undefined && prevalence !== null ? (
              <ReferenceLine
                y={prevalence}
                stroke={chartColors.reference}
                strokeDasharray="2 4"
                label={{ value: `chance ${formatNumber(prevalence, { digits: 2 })}`, position: "insideBottomLeft", fill: chartColors.tick, fontSize: 10, fontFamily: MONO }}
              />
            ) : null}
            <Tooltip
              cursor={{ stroke: chartColors.axis }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const pt = payload[0]?.payload as Record<string, number> | undefined;
                return (
                  <ChartTooltipCard
                    title={pt ? `${xLabel} ${formatNumber(pt[xKey], { digits: 3 })}` : undefined}
                    rows={payload.map((p, i) => ({
                      key: `${p.name}-${i}`,
                      label: p.name,
                      color: p.color,
                      value: formatNumber(Number(p.value), { digits: 3 }),
                    }))}
                  />
                );
              }}
            />
            {models.map((m, i) => {
              const s = seriesStyle(m.modelType, i);
              const pts = (kind === "roc" ? m.roc : m.pr) ?? [];
              return (
                <Line
                  key={m.id}
                  data={pts}
                  dataKey={yKey}
                  name={m.label}
                  type="linear"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={DASHARRAY[s.dash]}
                  dot={false}
                  activeDot={{ r: 4, stroke: chartColors.surface, strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function RocPrChart({ models, mode = "both", prevalence, height = 280, className }: RocPrChartProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className={cn("flex gap-6", mode === "both" ? "flex-col md:flex-row" : "flex-col")}>
        {mode !== "pr" ? <CurvePanel kind="roc" models={models} height={height} /> : null}
        {mode !== "roc" ? <CurvePanel kind="pr" models={models} prevalence={prevalence} height={height} /> : null}
      </div>
      <ChartLegend
        items={models.map((m, i) => {
          const s = seriesStyle(m.modelType, i);
          const parts = [
            mode !== "pr" && m.rocAuc !== undefined && m.rocAuc !== null ? `ROC-AUC ${formatNumber(m.rocAuc, { digits: 3 })}` : null,
            mode !== "roc" && m.prAuc !== undefined && m.prAuc !== null ? `PR-AUC ${formatNumber(m.prAuc, { digits: 3 })}` : null,
          ].filter(Boolean);
          return { key: m.id, label: m.label, color: s.color, dash: s.dash, value: parts.join(" · ") || undefined };
        })}
      />
    </div>
  );
}
