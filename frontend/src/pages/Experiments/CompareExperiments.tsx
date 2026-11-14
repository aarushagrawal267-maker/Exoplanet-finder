/**
 * Two or more experiments side by side (`/api/experiments/compare`): summary metrics, the
 * configuration differences (and what they share), overlaid epoch curves and the comparison
 * report download.
 */
import { ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { useCompareExperiments } from "@/api/endpoints/experiments";
import type { EpochOut } from "@/api/schemasOps";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import { formatDuration, formatInt } from "@/lib/format";
import { EpochChart, StatusBadge, type EpochMetricKey } from "../_ops/components";
import { bestOf, CONFIG_LABEL, fmtMetric, formatConfigValue, metricOf, modelTypeLabel } from "../_ops/metrics";
import { ReportButtons } from "./ReportButtons";

const SUMMARY: Array<{ key: string; label: string }> = [
  { key: "pr_auc", label: "Val PR-AUC" },
  { key: "roc_auc", label: "Val ROC-AUC" },
  { key: "f1", label: "Val F1" },
  { key: "ece", label: "Val ECE" },
];

export function CompareExperiments({ ids, onRemove, onClear }: { ids: number[]; onRemove: (id: number) => void; onClear: () => void }) {
  const q = useCompareExperiments(ids);
  const [metric, setMetric] = useState<EpochMetricKey>("val_pr_auc");
  const data = q.data;
  const exps = data?.experiments ?? [];
  const types = exps.map((e) => e.model_type);
  const bySlot = new Set(types).size !== types.length;
  const series = exps.map((e) => ({ id: String(e.id), label: `#${e.id} ${e.name}`, modelType: e.model_type, points: (data?.curves[String(e.id)] ?? []) as EpochOut[] }));

  return (
    <Card>
      <CardHeader
        title={`Comparing ${ids.length} experiments`}
        description="Validation metrics are optimistic for every run alike, so they rank runs on the same dataset fairly; use test evaluations for final numbers."
        actions={
          <Button size="sm" variant="ghost" icon={<X />} onClick={onClear}>
            Clear
          </Button>
        }
      />
      {q.isError ? <ApiErrorBanner error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isLoading ? <ChartSkeleton height={220} label="Loading comparison" /> : null}
      {data ? (
        <div className="flex flex-col gap-6">
          {data.warnings.length ? (
            <Banner tone="warn" title="Check before comparing">
              <ul className="list-disc pl-5">
                {data.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Banner>
          ) : null}

          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm" aria-label="Experiment summary">
              <thead>
                <tr className="eyebrow text-fg-secondary">
                  <th scope="col" className="border-b border-hairline py-2 pr-3 text-left font-medium">
                    Experiment
                  </th>
                  {SUMMARY.map((s) => (
                    <th key={s.key} scope="col" className="border-b border-hairline px-3 py-2 text-right font-medium">
                      {s.label}
                    </th>
                  ))}
                  <th scope="col" className="border-b border-hairline px-3 py-2 text-right font-medium">
                    Epochs
                  </th>
                  <th scope="col" className="border-b border-hairline py-2 pl-3 text-right font-medium">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {exps.map((e) => (
                  <tr key={e.id}>
                    <th scope="row" className="min-w-[240px] border-b border-hairline py-2 pr-3 text-left font-normal">
                      <span className="flex items-center gap-2">
                        <button type="button" onClick={() => onRemove(e.id)} aria-label={`Remove experiment ${e.id} from the comparison`} className="rounded-sm p-0.5 text-fg-secondary hover:text-fg">
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                        <span className="flex flex-col">
                          <span className="text-fg">
                            <span className="num text-fg-secondary">#{e.id}</span> {e.name}
                          </span>
                          <span className="flex items-center gap-1.5 text-xs text-fg-secondary">
                            {modelTypeLabel(e.model_type)} · {e.dataset_name} <StatusBadge status={e.status} />
                          </span>
                        </span>
                      </span>
                    </th>
                    {SUMMARY.map((s) => {
                      const v = metricOf(e.val_summary, s.key);
                      const best = v !== null && v === bestOf(s.key, exps.map((x) => metricOf(x.val_summary, s.key)));
                      return (
                        <td key={s.key} className={cn("num border-b border-hairline px-3 py-2 text-right", best ? "font-semibold text-cosmic" : "text-fg")}>
                          {best ? <span className="sr-only">best: </span> : null}
                          {fmtMetric(v)}
                        </td>
                      );
                    })}
                    <td className="num border-b border-hairline px-3 py-2 text-right text-fg">
                      {e.best_epoch ? `${e.best_epoch} / ` : ""}
                      {formatInt(e.epochs_run)}
                    </td>
                    <td className="num border-b border-hairline py-2 pl-3 text-right text-fg">{formatDuration(e.duration_s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-2 text-md font-semibold text-fg">Configuration differences</h3>
            {data.config_diff.length ? (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[480px] border-separate border-spacing-0 text-sm" aria-label="Configuration differences">
                  <thead>
                    <tr className="eyebrow text-fg-secondary">
                      <th scope="col" className="border-b border-hairline py-2 pr-3 text-left font-medium">
                        Setting
                      </th>
                      {exps.map((e) => (
                        <th key={e.id} scope="col" className="border-b border-hairline px-3 py-2 text-right font-medium">
                          #{e.id}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.config_diff.map((row) => (
                      <tr key={row.key}>
                        <th scope="row" className="border-b border-hairline py-1.5 pr-3 text-left font-normal text-fg-secondary">
                          {CONFIG_LABEL[row.key] ?? row.key} <span className="num text-2xs">{CONFIG_LABEL[row.key] ? row.key : ""}</span>
                        </th>
                        {exps.map((e) => (
                          <td key={e.id} className="num border-b border-hairline px-3 py-1.5 text-right text-fg">
                            {formatConfigValue(row.values[String(e.id)])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-fg-secondary">The configurations are identical.</p>
            )}
            {Object.keys(data.config_same).length ? (
              <details className="group mt-3 text-sm">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-fg-secondary hover:text-fg [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
                  {Object.keys(data.config_same).length} shared settings
                </summary>
                <dl className="mt-2 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  {Object.entries(data.config_same).map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3 border-b border-hairline py-1">
                      <dt className="text-fg-secondary">{CONFIG_LABEL[k] ?? k}</dt>
                      <dd className="num text-right text-fg">{formatConfigValue(v)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-md font-semibold text-fg">Epoch curves</h3>
              <SegmentedControl<EpochMetricKey>
                aria-label="Curve metric"
                size="sm"
                value={metric}
                onChange={setMetric}
                options={[
                  { value: "val_pr_auc", label: "Val PR-AUC" },
                  { value: "val_roc_auc", label: "Val ROC-AUC" },
                  { value: "val_loss", label: "Val loss" },
                  { value: "train_loss", label: "Train loss" },
                ]}
              />
            </div>
            {series.some((s) => s.points.length > 1) ? (
              <EpochChart series={series} metric={metric} height={260} bySlot={bySlot} />
            ) : (
              <p className="text-sm text-fg-secondary">These runs have at most one epoch each (baselines fit in one step), so there are no curves to overlay.</p>
            )}
          </div>

          <div className="border-t border-hairline pt-4">
            <ReportButtons experimentIds={ids} />
          </div>
        </div>
      ) : null}
    </Card>
  );
}
