/**
 * QualityReport — the preprocessing pipeline's data-quality assessment of one signal
 * (astro/quality.py): a grade A–D, the list of issues found, and which of them are blocking
 * (a blocking issue means the model views are unreliable, so the verdict is shown as uncertain).
 */
import { CircleCheck, OctagonAlert, TriangleAlert } from "lucide-react";
import type { QualityIssue, QualityIssueCode, QualityReportData } from "@/api/types";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { formatInt, formatPercent } from "@/lib/format";
import { GradeMark } from "./GradeMark";
import { GRADE_INFO } from "./verdict";

/** Plain-language explanations of each issue code (CONTRACTS.md §1, quality.py). */
export const ISSUE_TEXT: Record<QualityIssueCode, { title: string; detail: string; blocking: boolean }> = {
  too_few_transits: {
    title: "Too few transits observed",
    detail: "Fewer than two transits fall on valid data, so period and shape cannot be confirmed.",
    blocking: true,
  },
  low_transit_coverage: {
    title: "Low transit coverage",
    detail: "Many predicted transits land in data gaps; the folded curve rests on fewer events.",
    blocking: false,
  },
  local_view_sparse: {
    title: "Local view is sparse",
    detail: "More than 30% of the transit-window bins are empty and had to be interpolated.",
    blocking: true,
  },
  global_view_sparse: {
    title: "Global view is sparse",
    detail: "More than half of the full-orbit bins are empty.",
    blocking: false,
  },
  misaligned: {
    title: "Transit is off-centre",
    detail: "The deepest point sits more than half a duration from the predicted mid-transit; the ephemeris may be off.",
    blocking: false,
  },
  depth_mismatch: {
    title: "Depth disagrees with the catalogue",
    detail: "Measured depth is less than ⅓ or more than 3× the catalogue depth.",
    blocking: false,
  },
  nan_in_views: {
    title: "Invalid values in model input",
    detail: "The binned views contain NaN values and cannot be scored.",
    blocking: true,
  },
  period_too_long: {
    title: "Period too long for the baseline",
    detail: "The period exceeds half the observing baseline, so at most one transit can be seen.",
    blocking: true,
  },
  no_transit_signal: {
    title: "No transit dip detected",
    detail: "The local view shows no dip deeper than the noise (depth < 1σ).",
    blocking: false,
  },
};

function issueInfo(issue: QualityIssue) {
  const known = ISSUE_TEXT[issue.code as QualityIssueCode];
  return {
    title: known?.title ?? issue.code,
    detail: issue.message ?? known?.detail ?? "",
    blocking: issue.blocking ?? known?.blocking ?? false,
  };
}

export interface QualityReportProps {
  report: QualityReportData;
  className?: string;
}

export function QualityReport({ report, className }: QualityReportProps) {
  const issues = report.issues.map((i) => ({ ...issueInfo(i), code: i.code }));
  const blocking = issues.filter((i) => i.blocking);
  return (
    <section className={cn("card-surface p-5", className)} aria-label="Data quality report">
      <div className="flex items-start gap-4">
        <GradeMark grade={report.grade} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-md font-semibold text-fg">Data quality · {GRADE_INFO[report.grade].title}</h3>
            {report.ok ? (
              <Badge tone="cosmic" icon={<CircleCheck />}>
                Usable for scoring
              </Badge>
            ) : (
              <Badge tone="danger" icon={<OctagonAlert />}>
                Not reliable
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-fg-secondary">{GRADE_INFO[report.grade].description}</p>
        </div>
      </div>

      {(report.n_transits_observed !== undefined || report.local_empty_frac !== undefined || report.global_empty_frac !== undefined) && (
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-hairline pt-4 sm:grid-cols-3">
          {report.n_transits_observed !== undefined ? (
            <div>
              <dt className="eyebrow text-fg-secondary">Transits observed</dt>
              <dd className="num mt-1 text-md text-fg">
                {formatInt(report.n_transits_observed)}
                {report.n_transits_expected !== undefined && report.n_transits_expected !== null ? (
                  <span className="text-sm text-fg-secondary"> / {formatInt(report.n_transits_expected)}</span>
                ) : null}
              </dd>
            </div>
          ) : null}
          {report.local_empty_frac !== undefined ? (
            <div>
              <dt className="eyebrow text-fg-secondary">Local empty bins</dt>
              <dd className="num mt-1 text-md text-fg">{formatPercent(report.local_empty_frac)}</dd>
            </div>
          ) : null}
          {report.global_empty_frac !== undefined ? (
            <div>
              <dt className="eyebrow text-fg-secondary">Global empty bins</dt>
              <dd className="num mt-1 text-md text-fg">{formatPercent(report.global_empty_frac)}</dd>
            </div>
          ) : null}
        </dl>
      )}

      <div className="mt-4 border-t border-hairline pt-4">
        {issues.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-fg-secondary">
            <CircleCheck className="size-4 text-cosmic" aria-hidden="true" /> No issues detected.
          </p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label={`${issues.length} quality issues, ${blocking.length} blocking`}>
            {issues.map((i) => (
              <li key={i.code} className="flex items-start gap-3">
                {i.blocking ? (
                  <OctagonAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                ) : (
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-fg">{i.title}</span>
                    {i.blocking ? <Badge tone="danger">Blocking</Badge> : <Badge tone="warn">Caution</Badge>}
                    <code className="text-2xs text-fg-secondary">{i.code}</code>
                  </div>
                  {i.detail ? <p className="mt-0.5 text-xs text-fg-secondary">{i.detail}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
