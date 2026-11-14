/**
 * VerdictPanel — how one model scored one signal, with everything needed to judge that score:
 *
 *  - a horizontal calibrated-probability scale 0–1 with the decision threshold marked,
 *  - the probability needle, an uncertainty band (±1σ: ensemble spread or MC-dropout std),
 *  - one dot per ensemble member (agreement at a glance),
 *  - the data-quality grade A–D of the model input,
 *  - the catalogue classification beside it (provenance: NASA Exoplanet Archive),
 *  - and, always, the note that a planet-like score is a research lead, not a discovery.
 */
import { Info, TriangleAlert } from "lucide-react";
import type { QualityGrade, SignalClass } from "@/api/types";
import { Banner } from "@/components/ui/Banner";
import { ClassBadge } from "@/components/ui/ClassBadge";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { cn } from "@/lib/cn";
import { useElementWidth } from "@/lib/hooks";
import { formatProbability } from "@/lib/format";
import { colors } from "@/styles/tokens";
import { GradeMark } from "./GradeMark";
import { GRADE_INFO, verdictClass } from "./verdict";

export const RESEARCH_LEAD_NOTE = "Research lead — not a confirmed discovery";

export interface CatalogueClassification {
  /** Archive disposition text, e.g. "CONFIRMED", "FALSE POSITIVE", "CANDIDATE", or an Autovetter label. */
  disposition: string;
  /** Class implied by the disposition (null for candidates / unknown). */
  cls?: SignalClass | null;
  /** e.g. "KOI cumulative table · 2026-11-14". */
  source?: string;
}

export interface VerdictPanelProps {
  /** Calibrated probability that the signal is planet-like (class 1). */
  probability: number | null;
  threshold: number;
  /** ±1σ uncertainty on the probability (ensemble std or MC-dropout std). */
  uncertainty?: number | null;
  /** Calibrated probabilities of the individual ensemble members. */
  memberProbabilities?: number[] | null;
  qualityGrade?: QualityGrade | null;
  catalogue?: CatalogueClassification | null;
  modelName?: string;
  /** The model is a fixture used for pipeline tests, not a trained research model. */
  isFixtureModel?: boolean;
  /** Which split of the model's dataset this signal belonged to (train → optimistic score). */
  seenInSplit?: "train" | "val" | "test" | null;
  className?: string;
}

const pct = (v: number) => `${Math.min(1, Math.max(0, v)) * 100}%`;

/** Ensemble-member dot diameter + 1 px breathing room, in px. */
const DOT_PITCH = 9;
/** Rows available above the track before dots are allowed to overlap. */
const MAX_DOT_ROWS = 3;

/**
 * Assign each ensemble-member probability a row so dots closer than `minSep` (in probability
 * units) stack upward instead of overlapping — a one-dimensional beeswarm. Greedy in sorted
 * order, so the result is deterministic. Returns the row index for each input, in input order.
 */
export function stackDots(values: readonly number[], minSep: number, maxRows = MAX_DOT_ROWS): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const lastInRow: number[] = [];
  const rows = new Array<number>(values.length).fill(0);
  for (const { v, i } of order) {
    let r = lastInRow.findIndex((last) => v - last >= minSep);
    if (r === -1) r = lastInRow.length < maxRows ? lastInRow.length : 0;
    lastInRow[r] = v;
    rows[i] = r;
  }
  return rows;
}

export function VerdictPanel({
  probability,
  threshold,
  uncertainty,
  memberProbabilities,
  qualityGrade,
  catalogue,
  modelName,
  isFixtureModel = false,
  seenInSplit,
  className,
}: VerdictPanelProps) {
  const [ref, width] = useElementWidth<HTMLElement>();
  const [scaleRef, scaleWidth] = useElementWidth<HTMLDivElement>();
  // Side-by-side context column only when the panel itself is wide enough.
  const wide = width >= 720;
  const cls = verdictClass(probability, threshold, uncertainty, qualityGrade);
  const hasP = probability !== null && Number.isFinite(probability);
  const u = uncertainty !== null && uncertainty !== undefined && Number.isFinite(uncertainty) ? uncertainty : null;
  const members = (memberProbabilities ?? []).filter((m) => Number.isFinite(m));
  // Minimum separation in probability units for dots not to touch (≈2 % before measurement).
  const dotRows = stackDots(members, scaleWidth > 0 ? DOT_PITCH / scaleWidth : 0.02);
  const t = Math.min(1, Math.max(0, threshold));
  const summary = hasP
    ? `Calibrated probability ${formatProbability(probability)}${u !== null ? ` ± ${formatProbability(u)}` : ""}, threshold ${formatProbability(threshold)}`
    : "No probability available";

  return (
    <section ref={ref} className={cn("card-surface p-5", className)} aria-label="Model verdict">
      <div className={cn("grid gap-6", wide ? "grid-cols-[minmax(0,1fr)_220px]" : "grid-cols-1")}>
        {/* ---- Model side ---- */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="eyebrow text-fg-secondary">Model verdict</span>
              <ProvenanceChip kind="model" size="xs" source={modelName} />
            </div>
            {modelName ? <span className="num truncate text-xs text-fg-secondary">{modelName}</span> : null}
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-3">
            <div>
              <div className="num text-2xl font-medium leading-none text-fg" aria-hidden="true">
                {hasP ? formatProbability(probability) : "—"}
              </div>
              <div className="mt-1.5 text-xs text-fg-secondary">
                calibrated P(planet-like)
                {u !== null ? (
                  <>
                    {" "}
                    · <span className="num">± {formatProbability(u)}</span>
                  </>
                ) : null}
              </div>
            </div>
            <ClassBadge cls={cls} size="md" context="Model verdict" className="mb-0.5" />
          </div>

          {/* ---- Probability scale ---- */}
          <div className="mt-6" role="img" aria-label={summary} data-testid="verdict-scale">
            <div ref={scaleRef} className="relative h-11">
              {/* member dots: one row, stacking upward where members are too close to separate */}
              {members.map((m, i) => (
                <span
                  key={i}
                  className="absolute top-0 size-2 -translate-x-1/2 rounded-full border border-surface bg-nebula"
                  style={{ left: pct(m), top: -(dotRows[i] ?? 0) * DOT_PITCH }}
                  aria-hidden="true"
                  data-testid="member-dot"
                />
              ))}
              {/* track */}
              <div
                className="absolute inset-x-0 top-6 h-2 rounded-full"
                style={{
                  background: `linear-gradient(to right, ${colors["signal-fp"]}55 0%, ${colors["signal-uncertain"]}33 ${t * 100}%, ${colors["signal-planet"]}55 100%)`,
                }}
                aria-hidden="true"
              />
              {/* uncertainty band */}
              {hasP && u !== null ? (
                <span
                  className="absolute top-[18px] h-5 rounded-sm border-x border-fg-secondary bg-fg/[0.12]"
                  style={{ left: pct((probability as number) - u), width: `calc(${pct((probability as number) + u)} - ${pct((probability as number) - u)})` }}
                  aria-hidden="true"
                  data-testid="uncertainty-band"
                />
              ) : null}
              {/* threshold tick */}
              <span className="absolute top-3.5 h-7 w-0 -translate-x-1/2 border-l border-dashed border-fg" style={{ left: pct(t) }} aria-hidden="true" />
              {/* probability needle */}
              {hasP ? (
                <span className="absolute top-[14px] -translate-x-1/2" style={{ left: pct(probability as number) }} aria-hidden="true" data-testid="probability-needle">
                  <span className="block h-7 w-0.5 rounded-full bg-fg shadow-[0_0_0_2px_var(--c-surface)]" />
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex justify-between text-2xs">
              {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                <span key={v} className="num w-0 whitespace-nowrap text-fg-secondary [&:first-child]:text-left [&:last-child]:text-right" aria-hidden="true">
                  <span className={cn("inline-block", v === 0 ? "" : v === 1 ? "-translate-x-full" : "-translate-x-1/2")}>{v}</span>
                </span>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-xs" aria-hidden="true">
              <span className="text-signal-fp">← false-positive-like</span>
              <span className="text-signal-planet">planet-like →</span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
            {members.length > 0 ? (
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-nebula" aria-hidden="true" />
                <span className="num">{members.length}</span> ensemble members
              </span>
            ) : null}
            {u !== null ? (
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-4 rounded-[2px] border-x border-fg-secondary bg-fg/[0.12]" aria-hidden="true" />
                ±1σ uncertainty
              </span>
            ) : null}
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-0 border-l border-dashed border-fg" aria-hidden="true" />
              decision threshold <span className="num text-fg">{formatProbability(threshold, { digits: 2 })}</span>
            </span>
          </div>
        </div>

        {/* ---- Context side: quality + catalogue ---- */}
        <div className={cn("flex gap-4", wide ? "flex-col border-l border-hairline pl-6" : "flex-col border-t border-hairline pt-4 sm:flex-row sm:gap-8 [&>*]:flex-1")}>
          <div>
            <div className="eyebrow mb-2 text-fg-secondary">Input quality</div>
            {qualityGrade ? (
              <div className="flex items-center gap-3">
                <GradeMark grade={qualityGrade} />
                <p className="text-xs text-fg-secondary">{GRADE_INFO[qualityGrade].description}</p>
              </div>
            ) : (
              <p className="text-sm text-fg-secondary">Not assessed</p>
            )}
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              {/* "Disposition", not "Catalogue": the provenance chip beside it already says that. */}
              <span className="eyebrow text-fg-secondary">Disposition</span>
              <ProvenanceChip kind="catalogue" size="xs" source={catalogue?.source} />
            </div>
            {catalogue ? (
              <div className="flex flex-col items-start gap-1.5">
                <span className="num text-sm uppercase tracking-wide text-fg">{catalogue.disposition}</span>
                {catalogue.cls ? <ClassBadge cls={catalogue.cls} context="Catalogue classification" /> : null}
                {catalogue.cls && cls !== "uncertain" && catalogue.cls !== cls ? (
                  <span className="flex items-center gap-1 text-xs text-warn">
                    <TriangleAlert className="size-3.5" aria-hidden="true" /> Model disagrees with catalogue
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-fg-secondary">No catalogue classification</p>
            )}
          </div>
        </div>
      </div>

      {isFixtureModel ? (
        <Banner tone="fixture-model" className="mt-5" title="Fixture model">
          This score comes from a small pipeline-test model, not a trained research model. Do not interpret it.
        </Banner>
      ) : null}
      {seenInSplit === "train" ? (
        <Banner tone="warn" className="mt-3" title="Seen during training">
          This signal was in the model&apos;s training set, so the score is optimistic.
        </Banner>
      ) : null}

      <p className="mt-5 flex items-center gap-2 border-t border-hairline pt-4 text-sm text-fg" data-testid="research-lead-note">
        <Info className="size-4 shrink-0 text-cosmic" aria-hidden="true" />
        <span>
          <strong className="font-semibold">{RESEARCH_LEAD_NOTE}.</strong>{" "}
          <span className="text-fg-secondary">Confirmation needs follow-up observations and vetting.</span>
        </span>
      </p>
    </section>
  );
}
