/**
 * Grouped permutation importance of a logistic-regression / random-forest evaluation, plus the
 * model's intrinsic importances (coefficients or impurity importances) for reference.
 */
import { useFeatureImportance } from "@/api/endpoints/evaluation";
import { hasErrorCode, ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Banner } from "@/components/ui/Banner";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatInt, formatNumber, isFiniteNumber } from "@/lib/format";
import { fmtMetric } from "../_ops/metrics";

export function FeatureImportance({ evaluationId }: { evaluationId: number }) {
  const q = useFeatureImportance(evaluationId);
  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <p className="text-sm text-fg-secondary">Shuffling each input group and re-scoring the evaluated split…</p>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={14} width={`${90 - i * 10}%`} />
        ))}
      </div>
    );
  }
  if (q.isError) {
    if (hasErrorCode(q.error, "not_supported_for_cnn")) {
      return <Banner tone="info" title="Not available for CNNs">Permutation importance is computed for the baselines only.</Banner>;
    }
    return <ApiErrorBanner error={q.error} onRetry={() => void q.refetch()} />;
  }
  const fi = q.data;
  if (!fi) return null;
  const rows = [...fi.features].sort((a, b) => (b.importance_mean ?? 0) - (a.importance_mean ?? 0));
  const maxAbs = Math.max(1e-9, ...rows.map((r) => Math.abs(r.importance_mean ?? 0) + (r.importance_std ?? 0)));
  const intrinsic = fi.intrinsic.slice(0, 10);
  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-fg-secondary">
        {fi.method}. Baseline PR-AUC <span className="num text-fg">{fmtMetric(fi.baseline_score)}</span> on {formatInt(fi.n_examples)} {fi.split} examples ·{" "}
        {fi.n_repeats} repeats · seed {fi.seed}. Bars: mean drop; whiskers: ± 1 standard deviation. Groups with zero drop are not used by the model on this split.
      </p>
      <ul className="flex flex-col gap-1.5" aria-label="Permutation importance per input group">
        {rows.map((r) => {
          const mean = r.importance_mean ?? 0;
          const std = r.importance_std ?? 0;
          const w = (Math.max(0, mean) / maxAbs) * 100;
          const lo = Math.max(0, mean - std);
          const hi = mean + std;
          return (
            <li key={r.feature} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_88px] items-center gap-3 text-sm">
              <span className="min-w-0 truncate text-fg" title={`${r.label} (${r.n_columns} column${r.n_columns === 1 ? "" : "s"})`}>
                {r.label}
                {r.n_columns > 1 ? <span className="num text-2xs text-fg-secondary"> · {r.n_columns} cols</span> : null}
              </span>
              <span className="relative h-3 rounded-sm bg-hairline/60" aria-hidden="true">
                <span className="absolute inset-y-0 left-0 rounded-sm bg-cosmic/80" style={{ width: `${w}%` }} />
                {std > 0 ? (
                  <span className="absolute top-1/2 h-px -translate-y-1/2 bg-fg" style={{ left: `${(lo / maxAbs) * 100}%`, width: `${((hi - lo) / maxAbs) * 100}%` }} />
                ) : null}
              </span>
              <span className="num text-right text-fg">
                {formatNumber(mean, { digits: 3, signed: true })}
                <span className="text-2xs text-fg-secondary"> ±{formatNumber(std, { digits: 3 })}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {intrinsic.length ? (
        <div>
          <div className="eyebrow mb-1 text-fg-secondary">Intrinsic importances from training (top {intrinsic.length})</div>
          <p className="mb-2 text-xs text-fg-secondary">{fi.intrinsic_meaning}</p>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {intrinsic.map((row, i) => {
              const name = String(row.name ?? row.feature ?? `#${i + 1}`);
              const value = [row.weight, row.importance, row.value].find(isFiniteNumber);
              return (
                <li key={`${name}-${i}`} className="flex items-baseline justify-between gap-3 border-b border-hairline py-1">
                  <span className="num truncate text-fg-secondary">{name}</span>
                  <span className="num text-fg">{formatNumber(value, { digits: 4, signed: true })}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
