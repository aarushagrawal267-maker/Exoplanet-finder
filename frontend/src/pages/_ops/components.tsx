/**
 * UI pieces shared by the machine-learning operations pages: split labels that say how much a
 * number can be trusted, metric tiles with 95 % confidence intervals, status badges, a
 * multi-series epoch chart, lightweight SVG thumbnails of the model views, a confirmation dialog
 * and URL search-param state.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartLegend, ChartTooltipCard } from "@/components/charts/ChartParts";
import { chartColors, DASHARRAY, rcAxis, rcGrid, seriesStyle } from "@/components/charts/theme";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Tooltip as UiTooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { fmtCi, fmtMetric, METRICS } from "./metrics";

// ------------------------------------------------------------------------------------------------
// Split / status labels
// ------------------------------------------------------------------------------------------------
/**
 * How much a metric on this split can be trusted. Validation metrics are optimistic (threshold,
 * calibration and early stopping were tuned on that split); test metrics are the unbiased estimate.
 */
export function SplitTag({ split, testNumber, className }: { split: string; testNumber?: number | null; className?: string }) {
  if (split === "test") {
    return (
      <Badge tone="cosmic" className={className} title="Held-out test split: the unbiased estimate of performance">
        Test · unbiased{testNumber ? ` · #${testNumber}` : ""}
      </Badge>
    );
  }
  if (split === "val") {
    return (
      <Badge tone="uncertain" className={className} title="Threshold, calibration and early stopping were tuned on this split, so its metrics are optimistic">
        Validation · optimistic
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" className={className}>
      {split}
    </Badge>
  );
}

const STATUS_TONE: Record<string, BadgeTone> = {
  ready: "planet",
  succeeded: "planet",
  building: "cosmic",
  running: "cosmic",
  queued: "neutral",
  failed: "danger",
  cancelled: "uncertain",
};
const STATUS_TEXT: Record<string, string> = {
  ready: "Ready",
  succeeded: "Succeeded",
  building: "Building",
  running: "Running",
  queued: "Queued",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Status of a dataset / experiment / job, always as dot + text. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"} dot className={className}>
      {STATUS_TEXT[status] ?? status}
    </Badge>
  );
}

// ------------------------------------------------------------------------------------------------
// Metric tiles
// ------------------------------------------------------------------------------------------------
export interface MetricTileProps {
  metric: string;
  value: number | null;
  ci?: [number, number] | null;
  /** Highlight (e.g. the headline PR-AUC). */
  emphasis?: boolean;
  className?: string;
}

/** One metric with its 95 % bootstrap confidence interval underneath. */
export function MetricTile({ metric, value, ci, emphasis, className }: MetricTileProps) {
  const info = METRICS[metric];
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-lg border border-hairline bg-space/50 p-3", emphasis && "border-cosmic/40 bg-cosmic/[0.05]", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow truncate text-fg-secondary" title={info?.help}>
          {info?.label ?? metric}
        </span>
        {info?.lowerIsBetter ? <span className="text-2xs text-fg-secondary">lower is better</span> : null}
      </div>
      <span className={cn("num font-medium leading-none tracking-tight text-fg", emphasis ? "text-xl" : "text-lg")}>{fmtMetric(value)}</span>
      {ci !== undefined ? <span className="num text-xs text-fg-secondary">{ci ? <>95% CI {fmtCi(ci)}</> : "no interval"}</span> : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Epoch curves (several runs overlaid)
// ------------------------------------------------------------------------------------------------
export interface EpochSeries {
  id: string;
  label: string;
  modelType?: string;
  points: Array<{ epoch: number } & Partial<Record<EpochMetricKey, number | null>>>;
}

export type EpochMetricKey = "train_loss" | "val_loss" | "val_pr_auc" | "val_roc_auc" | "val_accuracy";

export const EPOCH_METRIC_LABEL: Record<EpochMetricKey, string> = {
  train_loss: "Training loss",
  val_loss: "Validation loss",
  val_pr_auc: "Validation PR-AUC",
  val_roc_auc: "Validation ROC-AUC",
  val_accuracy: "Validation accuracy (at 0.5)",
};

export interface EpochChartProps {
  series: EpochSeries[];
  metric: EpochMetricKey;
  height?: number;
  /** Colour by slot instead of model type (when several series share a model type). */
  bySlot?: boolean;
  className?: string;
}

/** One epoch metric for several runs on shared axes (colour + dash per series, legend below). */
export function EpochChart({ series, metric, height = 220, bySlot = false, className }: EpochChartProps) {
  const rows = useMemo(() => {
    const byEpoch = new Map<number, Record<string, number | null>>();
    for (const s of series) {
      for (const p of s.points) {
        const row = byEpoch.get(p.epoch) ?? { epoch: p.epoch };
        const v = p[metric];
        row[s.id] = typeof v === "number" && Number.isFinite(v) ? v : null;
        byEpoch.set(p.epoch, row);
      }
    }
    return [...byEpoch.values()].sort((a, b) => (a.epoch as number) - (b.epoch as number));
  }, [series, metric]);
  const bounded = metric !== "train_loss" && metric !== "val_loss";
  const xMax = Math.max(2, ...rows.map((r) => r.epoch as number));
  const styles = series.map((s, i) => seriesStyle(bySlot ? undefined : s.modelType, i));
  return (
    <figure className={cn("m-0 min-w-0", className)} aria-label={`${EPOCH_METRIC_LABEL[metric]} by epoch for ${series.map((s) => s.label).join(", ")}`}>
      <div className="eyebrow mb-2 text-fg-secondary">{EPOCH_METRIC_LABEL[metric]}</div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 20, left: 4 }}>
            <CartesianGrid {...rcGrid} />
            <XAxis
              dataKey="epoch"
              type="number"
              domain={[1, xMax]}
              allowDecimals={false}
              {...rcAxis}
              label={{ value: "Epoch", position: "insideBottom", offset: -12, fill: chartColors.title, fontSize: 12 }}
            />
            <YAxis
              width={48}
              {...rcAxis}
              domain={bounded ? [0, 1] : ["auto", "auto"]}
              ticks={bounded ? [0, 0.25, 0.5, 0.75, 1] : undefined}
              tickFormatter={(v: number) => formatNumber(v, { digits: 2 })}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: chartColors.axis }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <ChartTooltipCard
                    title={`epoch ${label}`}
                    rows={payload.map((p, i) => ({ key: `${String(p.dataKey)}-${i}`, label: p.name, color: p.color, value: formatNumber(Number(p.value), { digits: 4 }) }))}
                  />
                ) : null
              }
            />
            {series.map((s, i) => {
              const st = styles[i] ?? seriesStyle(undefined, i);
              return (
                <Line
                  key={s.id}
                  dataKey={s.id}
                  name={s.label}
                  stroke={st.color}
                  strokeWidth={2}
                  strokeDasharray={DASHARRAY[st.dash]}
                  dot={rows.length <= 3 ? { r: 3, fill: st.color, strokeWidth: 0 } : false}
                  isAnimationActive={false}
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {series.length > 1 ? (
        <ChartLegend
          className="mt-2"
          items={series.map((s, i) => {
            const st = styles[i] ?? seriesStyle(undefined, i);
            return { key: s.id, label: s.label, color: st.color, dash: st.dash };
          })}
        />
      ) : null}
    </figure>
  );
}

// ------------------------------------------------------------------------------------------------
// View thumbnails (SVG, for galleries and example lists; the full plot is ViewPairPlot)
// ------------------------------------------------------------------------------------------------
function pathFor(values: ReadonlyArray<number | null>, width: number, height: number, lo: number, hi: number): string {
  const n = values.length;
  if (n < 2) return "";
  const span = hi - lo || 1;
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    const x = (i / (n - 1)) * width;
    const y = ((hi - v) / span) * height;
    d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  });
  return d;
}

function range(values: ReadonlyArray<number | null>): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo)) return [-1, 0.2];
  const pad = (hi - lo) * 0.08 || 0.1;
  return [lo - pad, hi + pad];
}

export interface ViewThumbProps {
  values: ReadonlyArray<number | null>;
  label: string;
  width?: number;
  height?: number;
  className?: string;
}

/** A model view (normalised flux: baseline 0, transit minimum −1) as a tiny line drawing. */
export function ViewThumb({ values, label, width = 160, height = 56, className }: ViewThumbProps) {
  const [lo, hi] = range(values);
  const zeroY = ((hi - 0) / (hi - lo || 1)) * height;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label} className={cn("block h-14 w-full", className)}>
      <line x1="0" x2={width} y1={zeroY} y2={zeroY} stroke="var(--c-hairline-strong)" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      <path d={pathFor(values, width, height, lo, hi)} fill="none" stroke="var(--c-nebula)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// ------------------------------------------------------------------------------------------------
// Confirmation dialog
// ------------------------------------------------------------------------------------------------
export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  danger?: boolean;
  confirmDisabled?: boolean;
}

export function ConfirmDialog({ open, title, description, children, confirmLabel, onConfirm, onClose, busy, danger = true, confirmDisabled }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      description={description}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------
// Search-param state
// ------------------------------------------------------------------------------------------------
/** Read / patch URL search params (null or "" removes a key); replaces history by default. */
export function useParamState(): [URLSearchParams, (patch: Record<string, string | number | null | undefined>, opts?: { push?: boolean }) => void] {
  const [params, setParams] = useSearchParams();
  const update = useCallback(
    (patch: Record<string, string | number | null | undefined>, opts: { push?: boolean } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined || v === "") next.delete(k);
            else next.set(k, String(v));
          }
          return next;
        },
        { replace: !opts.push },
      );
    },
    [setParams],
  );
  return [params, update];
}

// ------------------------------------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------------------------------------
/** Inline "?" help with a tooltip (supplementary text only). */
export function Hint({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <UiTooltip content={text}>
      <button type="button" className="ml-1 inline-flex size-4 items-center justify-center rounded-full border border-hairline-strong text-[10px] text-fg-secondary hover:text-fg" aria-label={text}>
        {children ?? "?"}
      </button>
    </UiTooltip>
  );
}

/** A labelled number with a muted unit, for compact stat rows. */
export function MiniStat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="eyebrow text-fg-secondary">{label}</div>
      <div className="num mt-0.5 truncate text-md text-fg">{value}</div>
      {sub ? <div className="text-xs text-fg-secondary">{sub}</div> : null}
    </div>
  );
}
