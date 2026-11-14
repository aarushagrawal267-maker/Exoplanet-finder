/**
 * Several evaluations side by side (`/api/evaluation/compare`): warnings when datasets or splits
 * differ, metric bars with 95 % CIs, the aligned metric table with the best value marked, and
 * overlaid ROC / PR and reliability curves.
 */
import { useQueries } from "@tanstack/react-query";
import { X } from "lucide-react";
import { fetchEvaluation, useCompareEvaluations } from "@/api/endpoints/evaluation";
import { qkOps } from "@/api/endpoints/keysOps";
import type { EvaluationOut } from "@/api/schemasOps";
import { CalibrationChart } from "@/components/charts/CalibrationChart";
import { MetricBars } from "@/components/charts/MetricBars";
import { RocPrChart } from "@/components/charts/RocPrChart";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import { formatInt, formatProbability } from "@/lib/format";
import { SplitTag } from "../_ops/components";
import { ciOf, fmtCi, fmtMetric, METRICS, metricOf, modelTypeLabel } from "../_ops/metrics";
import { curvesOf, reliabilityOf } from "./EvaluationResults";

const BAR_METRICS = ["pr_auc", "roc_auc", "f1", "precision", "recall"];

export function evaluationLabel(e: Pick<EvaluationOut, "id" | "model_name" | "split" | "model_version_id">): string {
  return `#${e.id} ${e.model_name ?? `model ${e.model_version_id}`} (${e.split === "val" ? "val" : e.split})`;
}

export function CompareEvaluations({ ids, onRemove, onClear }: { ids: number[]; onRemove: (id: number) => void; onClear: () => void }) {
  const cmp = useCompareEvaluations(ids);
  const details = useQueries({
    queries: ids.map((id) => ({
      queryKey: qkOps.evaluation.detail(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchEvaluation(id, signal),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
  const evs = cmp.data?.evaluations ?? [];
  // Colour by model type unless two evaluations share one (then by slot, so they stay distinct).
  const types = evs.map((e) => e.model_type ?? "");
  const uniqueTypes = new Set(types).size === types.length;
  const models = evs.map((e) => ({ id: String(e.id), label: evaluationLabel(e), modelType: uniqueTypes ? (e.model_type ?? undefined) : undefined }));
  const loaded = details.map((d) => d.data).filter((d): d is NonNullable<typeof d> => Boolean(d));

  return (
    <Card>
      <CardHeader
        title={`Comparing ${ids.length} evaluations`}
        description="Comparisons are only meaningful on the same dataset and split. Overlapping confidence intervals mean the split cannot tell the models apart."
        actions={
          <Button size="sm" variant="ghost" icon={<X />} onClick={onClear}>
            Clear
          </Button>
        }
      />
      {cmp.isError ? <ApiErrorBanner error={cmp.error} onRetry={() => void cmp.refetch()} /> : null}
      {cmp.isLoading ? <ChartSkeleton height={220} label="Loading comparison" /> : null}
      {cmp.data ? (
        <div className="flex flex-col gap-6">
          {cmp.data.warnings.length ? (
            <Banner tone="warn" title={cmp.data.comparable ? "Check before comparing" : "These evaluations are not directly comparable"}>
              <ul className="list-disc pl-5">
                {cmp.data.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Banner>
          ) : null}
          <ul className="flex flex-wrap gap-2" aria-label="Evaluations in this comparison">
            {evs.map((e) => (
              <li key={e.id} className="flex items-center gap-2 rounded-md border border-hairline px-2.5 py-1.5 text-sm">
                <span className="text-fg">{evaluationLabel(e)}</span>
                <SplitTag split={e.split} testNumber={e.test_evaluation_number} />
                <span className="text-xs text-fg-secondary">
                  {modelTypeLabel(e.model_type)} · {e.dataset_name} · n {formatInt(e.n)}
                </span>
                <button type="button" onClick={() => onRemove(e.id)} aria-label={`Remove evaluation ${e.id} from the comparison`} className="rounded-sm p-0.5 text-fg-secondary hover:text-fg">
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <MetricBars
            models={models}
            groups={BAR_METRICS.map((k) => ({
              metric: METRICS[k]?.label ?? k,
              help: k === "pr_auc" ? "chance = positive fraction" : undefined,
              values: evs.map((e) => {
                const row = cmp.data?.metrics.find((r) => r.metric === k);
                return { modelId: String(e.id), value: row?.values[String(e.id)] ?? null, ci: ciOf(row?.ci, String(e.id)) };
              }),
            }))}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-separate border-spacing-0 text-sm" aria-label="Aligned metrics with 95% confidence intervals">
              <thead>
                <tr className="eyebrow text-fg-secondary">
                  <th scope="col" className="border-b border-hairline py-2 pr-3 text-left font-medium">
                    Metric
                  </th>
                  {evs.map((e) => (
                    <th key={e.id} scope="col" className="border-b border-hairline px-3 py-2 text-right font-medium normal-case tracking-normal">
                      {evaluationLabel(e)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cmp.data.metrics.map((row) => (
                  <tr key={row.metric}>
                    <th scope="row" className="border-b border-hairline py-1.5 pr-3 text-left font-normal text-fg-secondary">
                      {METRICS[row.metric]?.label ?? row.metric.replace(/_/g, " ")}
                    </th>
                    {evs.map((e) => {
                      const v = row.values[String(e.id)] ?? null;
                      const best = row.best === String(e.id);
                      const isCount = row.metric === "n" || row.metric === "n_pos" || row.metric === "n_neg";
                      return (
                        <td key={e.id} className={cn("num border-b border-hairline px-3 py-1.5 text-right", best ? "text-fg" : "text-fg-secondary")}>
                          {best ? <span className="sr-only">best: </span> : null}
                          <span className={best ? "font-semibold text-cosmic" : undefined}>
                            {isCount ? formatInt(v) : row.metric === "threshold" ? formatProbability(v) : fmtMetric(v)}
                          </span>
                          {ciOf(row.ci, String(e.id)) ? <span className="block text-2xs">{fmtCi(ciOf(row.ci, String(e.id)))}</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-fg-secondary">Best value per row in bold blue (lower is better for Brier and ECE).</p>
          </div>
          {loaded.length === ids.length ? (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div>
                <div className="eyebrow mb-2 text-fg-secondary">Curves</div>
                <RocPrChart
                  models={loaded.map((d, i) => curvesOf(d, models[i]?.label, models[i]?.modelType))}
                  prevalence={loaded.length && loaded.every((d) => d.dataset_id === loaded[0]?.dataset_id && d.split === loaded[0]?.split) ? (loaded[0]?.n_pos ?? 0) / Math.max(1, loaded[0]?.n ?? 1) : null}
                  height={240}
                />
              </div>
              <div>
                <div className="eyebrow mb-2 text-fg-secondary">Reliability</div>
                <CalibrationChart
                  series={loaded.map((d, i) => ({ id: String(d.id), label: models[i]?.label ?? String(d.id), modelType: models[i]?.modelType, bins: reliabilityOf(d), ece: metricOf(d.metrics, "ece") }))}
                  height={220}
                />
              </div>
            </div>
          ) : (
            <ChartSkeleton height={240} label="Loading curves" />
          )}
        </div>
      ) : null}
    </Card>
  );
}
