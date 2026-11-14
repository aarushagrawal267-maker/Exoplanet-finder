/**
 * One evaluation in full: what the numbers mean (validation = optimistic, test = unbiased), metric
 * tiles with 95 % bootstrap CIs, the threshold comparison (validation-chosen vs 0.5), ROC / PR
 * curves, the reliability diagram with ECE, the confusion matrix, inference timing, error analysis
 * per confusion-matrix cell and (baselines) permutation feature importance.
 */
import { Clock } from "lucide-react";
import type { ReactNode } from "react";
import { useEvaluation } from "@/api/endpoints/evaluation";
import type { EvaluationDetailOut } from "@/api/schemasOps";
import { CalibrationChart, type ReliabilityBin } from "@/components/charts/CalibrationChart";
import { ConfusionMatrix } from "@/components/charts/ConfusionMatrix";
import { RocPrChart, type CurveModel } from "@/components/charts/RocPrChart";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { ChartSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { formatDateTime, formatInt, formatNumber, formatPercent, formatProbability, isFiniteNumber } from "@/lib/format";
import { MetricTile, SplitTag } from "../_ops/components";
import { apiDate, ciOf, fmtMetric, HEADLINE_METRICS, isBaseline, metricOf, modelTypeLabel } from "../_ops/metrics";
import { ErrorAnalysis } from "./ErrorAnalysis";
import { FeatureImportance } from "./FeatureImportance";

/** ROC / PR points from the stored curves (drop points with missing coordinates). */
export function curvesOf(ev: EvaluationDetailOut, label?: string, modelType?: string): CurveModel {
  const roc = (ev.curves.roc ?? []).flatMap((p) => (isFiniteNumber(p.fpr) && isFiniteNumber(p.tpr) ? [{ fpr: p.fpr, tpr: p.tpr }] : []));
  const pr = (ev.curves.pr ?? []).flatMap((p) => (isFiniteNumber(p.recall) && isFiniteNumber(p.precision) ? [{ recall: p.recall, precision: p.precision }] : []));
  return {
    id: String(ev.id),
    label: label ?? `${ev.model_name ?? `model ${ev.model_version_id}`}`,
    modelType: modelType ?? ev.model_type ?? undefined,
    roc,
    pr,
    rocAuc: metricOf(ev.metrics, "roc_auc"),
    prAuc: metricOf(ev.metrics, "pr_auc"),
  };
}

export function reliabilityOf(ev: EvaluationDetailOut): ReliabilityBin[] {
  return (ev.curves.calibration ?? []).map((b) => ({
    bin_lo: Number(b.bin_lo),
    bin_hi: Number(b.bin_hi),
    mean_pred: isFiniteNumber(b.mean_pred) ? b.mean_pred : null,
    frac_pos: isFiniteNumber(b.frac_pos) ? b.frac_pos : null,
    count: isFiniteNumber(b.count) ? b.count : 0,
  }));
}

const THRESHOLD_ROWS: Array<{ key: string; label: string; kind: "metric" | "count" }> = [
  { key: "precision", label: "Precision", kind: "metric" },
  { key: "recall", label: "Recall", kind: "metric" },
  { key: "f1", label: "F1", kind: "metric" },
  { key: "specificity", label: "Specificity", kind: "metric" },
  { key: "accuracy", label: "Accuracy", kind: "metric" },
  { key: "tp", label: "True positives", kind: "count" },
  { key: "fp", label: "False positives", kind: "count" },
  { key: "fn", label: "False negatives", kind: "count" },
  { key: "tn", label: "True negatives", kind: "count" },
];

function ThresholdTable({ ev }: { ev: EvaluationDetailOut }) {
  const at05 = (ev.metrics_at_0_5 ?? {}) as Record<string, unknown>;
  const m = ev.metrics as Record<string, unknown>;
  const fmt = (v: number | null, kind: string) => (kind === "count" ? formatInt(v) : fmtMetric(v));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[360px] border-separate border-spacing-0 text-sm" aria-label="Metrics at the validation-chosen threshold and at 0.5">
        <thead>
          <tr className="eyebrow text-fg-secondary">
            <th scope="col" className="border-b border-hairline py-2 pr-3 text-left font-medium">
              Metric
            </th>
            <th scope="col" className="border-b border-hairline px-3 py-2 text-right font-medium">
              <span className="normal-case tracking-normal">Chosen</span> <span className="num text-fg">{formatProbability(ev.threshold)}</span>
            </th>
            <th scope="col" className="border-b border-hairline py-2 pl-3 text-right font-medium">
              <span className="normal-case tracking-normal">At</span> <span className="num text-fg">0.500</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {THRESHOLD_ROWS.map((r) => (
            <tr key={r.key}>
              <th scope="row" className="border-b border-hairline py-1.5 pr-3 text-left font-normal text-fg-secondary">
                {r.label}
              </th>
              <td className="num border-b border-hairline px-3 py-1.5 text-right text-fg">{fmt(metricOf(m, r.key), r.kind)}</td>
              <td className="num border-b border-hairline py-1.5 pl-3 text-right text-fg-secondary">{fmt(metricOf(at05, r.key), r.kind)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timing({ ev }: { ev: EvaluationDetailOut }) {
  const t = ev.timing as Record<string, unknown>;
  const ms1 = metricOf(t, "ms_per_sample_batch1");
  const ms64 = metricOf(t, "ms_per_sample_batch64");
  const cell = (label: ReactNode, value: ReactNode) => (
    <div>
      <dt className="text-xs text-fg-secondary">{label}</dt>
      <dd className="num text-md text-fg">{value}</dd>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-3 gap-3">
        {cell("Batch of 1", ms1 !== null ? `${formatNumber(ms1, { digits: ms1 < 1 ? 3 : 1 })} ms` : "—")}
        {cell("Batch of 64", ms64 !== null ? `${formatNumber(ms64, { digits: ms64 < 1 ? 3 : 1 })} ms` : "—")}
        {cell("Device", String(t.device ?? "—"))}
      </dl>
      <p className="text-xs text-fg-secondary">Median time per sample (warm-up excluded), measured without uncertainty estimation.</p>
    </div>
  );
}

export function EvaluationResults({ id }: { id: number }) {
  const q = useEvaluation(id);
  const ev = q.data;
  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton height={80} rounded="md" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} height={84} rounded="md" />
          ))}
        </div>
        <ChartSkeleton height={260} label="Loading curves" />
      </div>
    );
  }
  if (q.isError || !ev) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const n = ev.n ?? 0;
  const prevalence = n ? (ev.n_pos ?? 0) / n : null;
  const conf = ev.confusion;
  const ciMethod = (ev.ci_method ?? {}) as Record<string, unknown>;
  const curve = curvesOf(ev);
  const bins = reliabilityOf(ev);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          eyebrow={`Evaluation #${ev.id} · ${formatDateTime(apiDate(ev.created_at))}`}
          title={
            <span>
              {ev.model_name ?? `Model #${ev.model_version_id}`} <span className="text-fg-secondary">on</span> {ev.dataset_name ?? `dataset #${ev.dataset_id}`}
            </span>
          }
        >
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <SplitTag split={ev.split} testNumber={ev.test_evaluation_number} />
            <Badge>{modelTypeLabel(ev.model_type)}</Badge>
            <ProvenanceChip kind="model" source={`model version ${ev.model_version_id}`} size="xs" />
            <span className="num text-xs text-fg-secondary">
              n = {formatInt(ev.n)} · {formatInt(ev.n_pos)} planet-like · {formatInt(ev.n_neg)} false-positive-like · prevalence {formatPercent(prevalence, { digits: 0 })}
            </span>
          </div>
        </CardHeader>
        {ev.is_fixture ? (
          <Banner tone="fixture-model" title="Test-fixture model" className="mb-4">
            This model was trained on synthetic test data to exercise the pipeline. Its metrics are not scientific results.
          </Banner>
        ) : null}
        {ev.split === "val" ? (
          <Banner tone="info" title="Validation metrics are optimistic" className="mb-4">
            The decision threshold, the probability calibration and early stopping were all tuned on this split. Use a test evaluation for the unbiased estimate.
          </Banner>
        ) : (
          <Banner tone="info" title={`Test evaluation${ev.test_evaluation_number ? ` #${ev.test_evaluation_number} of this model` : ""}: the unbiased estimate`} className="mb-4">
            The test split was not used for training, model selection, threshold or calibration.
            {ev.test_evaluation_number && ev.test_evaluation_number > 1
              ? " This model has been evaluated on test more than once; if it was changed between runs, the later numbers are no longer fully unbiased."
              : ""}
          </Banner>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {HEADLINE_METRICS.map((k) => (
            <MetricTile key={k} metric={k} value={metricOf(ev.metrics, k)} ci={ciOf(ev.ci, k)} emphasis={k === "pr_auc"} />
          ))}
        </div>
        <p className="mt-3 text-xs text-fg-secondary">
          95 % confidence intervals: {String(ciMethod.method ?? "percentile")} bootstrap, {formatInt(metricOf(ciMethod, "n_boot"))} resamples of whole {ciMethod.resample === "star" ? "stars" : "examples"}
          {ciMethod.resample === "star" ? " (signals of one star are correlated)" : ""}. Wide intervals mean the split is too small to resolve differences.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="ROC and precision–recall curves" description="Dotted lines: a random classifier. PR is the more honest view under class imbalance." />
          {curve.roc?.length || curve.pr?.length ? (
            <RocPrChart models={[curve]} prevalence={prevalence} height={250} />
          ) : (
            <p className="text-sm text-fg-secondary">Curves are undefined: the evaluated split has a single class.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Decision threshold" description="Chosen to maximise F1 on validation; 0.5 shown for comparison." />
          <ThresholdTable ev={ev} />
        </Card>
        <Card>
          <CardHeader title="Reliability diagram" description={`Observed planet-like fraction per probability bin. ECE ${fmtMetric(metricOf(ev.metrics, "ece"))}.`} />
          <CalibrationChart series={[{ id: String(ev.id), label: ev.model_name ?? "model", modelType: ev.model_type ?? undefined, bins, ece: metricOf(ev.metrics, "ece") }]} height={230} />
        </Card>
        <Card className="flex flex-col gap-6">
          <div>
            <CardHeader title="Confusion matrix" description="Rows: catalogue label. Columns: model prediction at the chosen threshold." />
            <ConfusionMatrix tp={conf.tp ?? 0} fp={conf.fp ?? 0} tn={conf.tn ?? 0} fn={conf.fn ?? 0} threshold={ev.threshold} />
          </div>
          <div>
            <div className="mb-3 flex items-center gap-2 text-fg-secondary">
              <Clock className="size-4" aria-hidden="true" />
              <span className="eyebrow">Inference time</span>
            </div>
            <Timing ev={ev} />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Error analysis" description="The evaluated examples in each cell of the confusion matrix, most confident first. A confident “error” can also be a mislabelled signal." />
        {ev.per_example_available ? <ErrorAnalysis evaluationId={ev.id} counts={conf} /> : <p className="text-sm text-fg-secondary">Per-example results were not stored for this evaluation.</p>}
      </Card>

      <Card>
        <CardHeader
          title="Permutation feature importance"
          description="Drop in PR-AUC when one input group is shuffled across the evaluated examples: what the model relies on."
        />
        {isBaseline(ev.model_type) ? (
          <FeatureImportance evaluationId={ev.id} />
        ) : (
          <Banner tone="info" title="Not available for CNNs">
            The CNNs learn directly from the 2,001 + 201 view bins rather than from named features, so permutation importance of feature groups is only computed for logistic
            regression and random forest (the API answers 409 <span className="num">not_supported_for_cnn</span>). Inspect a CNN through its errors above instead.
          </Banner>
        )}
      </Card>
    </div>
  );
}
