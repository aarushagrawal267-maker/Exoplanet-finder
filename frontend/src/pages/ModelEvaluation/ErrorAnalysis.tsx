/**
 * Error analysis: evaluated examples per confusion-matrix cell (false positives, false negatives,
 * true positives, true negatives) with probability, catalogue labels, signal parameters, the local
 * view and a link to the target's dossier.
 */
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useEvaluationExamples } from "@/api/endpoints/evaluation";
import type { EvaluationExampleOut, EvaluationOutcome } from "@/api/schemasOps";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { ClassBadge, classFromLabel } from "@/components/ui/ClassBadge";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { formatDays, formatHours, formatKepid, formatPpm, formatProbability } from "@/lib/format";
import { ViewThumb } from "../_ops/components";

export const OUTCOMES: Array<{ id: EvaluationOutcome; label: string; help: string }> = [
  { id: "fp", label: "False positives", help: "Called planet-like, but the catalogue label is false-positive-like (e.g. eclipsing binaries without a visible secondary, blends)." },
  { id: "fn", label: "False negatives", help: "Planet-like signals the model missed (e.g. shallow, low-SNR or long-period transits)." },
  { id: "tp", label: "True positives", help: "Planet-like signals the model called planet-like." },
  { id: "tn", label: "True negatives", help: "False-positive-like signals the model rejected." },
];

const PAGE = 12;

function ExampleCard({ ex }: { ex: EvaluationExampleOut }) {
  const name = ex.kepler_name ?? ex.kepoi_name;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-hairline bg-space/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="num truncate text-sm text-fg">{ex.signal_key ?? `signal ${ex.signal_id}`}</p>
          {name ? <p className="truncate text-xs text-fg-secondary">{name}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          <div className="num text-md text-fg" title="Calibrated probability of planet-like">
            {formatProbability(ex.prob)}
          </div>
          <div className="num text-2xs text-fg-secondary" title="Uncalibrated model output">
            raw {formatProbability(ex.raw_prob)}
            {ex.uncertainty !== null && ex.uncertainty !== undefined ? ` · ±${formatProbability(ex.uncertainty)}` : ""}
          </div>
        </div>
      </div>
      {ex.local_view?.length ? (
        <ViewThumb values={ex.local_view} label={`Local view of ${ex.signal_key ?? ex.signal_id}`} />
      ) : (
        <p className="text-2xs text-fg-secondary">Local view unavailable.</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-2xs text-fg-secondary">label</span>
        <ClassBadge cls={classFromLabel(ex.label === 1 ? 1 : 0)} />
      </div>
      <dl className="grid grid-cols-3 gap-1 text-2xs">
        <div>
          <dt className="text-fg-secondary">Period</dt>
          <dd className="num text-fg">{formatDays(ex.period_days)}</dd>
        </div>
        <div>
          <dt className="text-fg-secondary">Depth</dt>
          <dd className="num text-fg">{formatPpm(ex.depth_ppm)}</dd>
        </div>
        <div>
          <dt className="text-fg-secondary">Duration</dt>
          <dd className="num text-fg">{formatHours(ex.duration_hours)}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2 text-2xs">
        <span className="num text-fg-secondary">
          AV {ex.av_training_set ?? "—"} · KOI {ex.koi_disposition ?? "—"}
        </span>
        <Link to={`/targets/${ex.kepid}`} className="num inline-flex items-center gap-1 text-cosmic hover:underline">
          {formatKepid(ex.kepid)} <ExternalLink className="size-3" aria-hidden="true" />
        </Link>
      </div>
    </li>
  );
}

function OutcomeList({ evaluationId, outcome }: { evaluationId: number; outcome: EvaluationOutcome }) {
  const [offset, setOffset] = useState(0);
  const q = useEvaluationExamples(evaluationId, { outcome, limit: PAGE, offset });
  const info = OUTCOMES.find((o) => o.id === outcome);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-secondary">{info?.help} Sorted by confidence.</p>
      {q.isError ? <ApiErrorBanner error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isLoading ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i}>
              <Skeleton height={190} rounded="md" />
            </li>
          ))}
        </ul>
      ) : q.data && q.data.items.length ? (
        <>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy={q.isFetching}>
            {q.data.items.map((ex) => (
              <ExampleCard key={ex.signal_id} ex={ex} />
            ))}
          </ul>
          {q.data.total > PAGE ? <Pagination total={q.data.total} offset={offset} limit={PAGE} noun="examples" busy={q.isFetching} onChange={(o) => setOffset(o)} /> : null}
        </>
      ) : (
        <p className="text-sm text-fg-secondary">No examples in this cell.</p>
      )}
    </div>
  );
}

export function ErrorAnalysis({ evaluationId, counts }: { evaluationId: number; counts: Record<string, number> }) {
  const [tab, setTab] = useState<string>("fp");
  return (
    <Tabs
      aria-label="Examples by outcome"
      value={tab}
      onChange={setTab}
      items={OUTCOMES.map((o) => ({
        id: o.id,
        label: o.label,
        count: counts[o.id] ?? 0,
        content: tab === o.id ? <OutcomeList evaluationId={evaluationId} outcome={o.id} /> : null,
      }))}
    />
  );
}
