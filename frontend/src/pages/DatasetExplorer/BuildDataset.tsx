/**
 * Build a dataset: label mode, tier cards with live catalogue counts and download/processing
 * estimates (`GET /api/datasets/tiers`), the build form, and the live progress of the build job.
 */
import { Hammer, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { datasetIdOfJob, useBuildDataset, useDatasetTiers } from "@/api/endpoints/datasets";
import type { JobOut } from "@/api/schemas";
import type { DatasetCreate, DatasetTier, DetrendMethod, LabelMode, TierOut } from "@/api/schemasOps";
import { JobProgress } from "@/components/jobs/JobProgress";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { NumberInput } from "@/components/ui/NumberInput";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/cn";
import { formatBytes, formatInt, formatNumber } from "@/lib/format";

export const LABEL_MODES: Array<{ value: LabelMode; label: string; help: string }> = [
  {
    value: "astronet_dr24",
    label: "AstroNet DR24",
    help: "DR24 Autovetter labels (PC → planet-like; AFP / NTP → false-positive-like), as in Shallue & Vanderburg (2018).",
  },
  {
    value: "koi_disposition",
    label: "KOI disposition",
    help: "KOI archive disposition (CONFIRMED / CANDIDATE → planet-like; FALSE POSITIVE → false-positive-like).",
  },
];

const TIER_ORDER: DatasetTier[] = ["pilot", "standard", "full", "custom"];
const TIER_NAME: Record<DatasetTier, string> = { pilot: "Pilot", standard: "Standard", full: "Full", custom: "Custom" };

function minutes(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return "—";
  if (m < 1) return "< 1 min";
  if (m < 90) return `≈ ${formatNumber(m, { digits: 0 })} min`;
  return `≈ ${formatNumber(m / 60, { digits: 1 })} h`;
}

function TierCard({ tier, info, selected, onSelect }: { tier: DatasetTier; info: TierOut | null; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "card-surface flex h-full flex-col gap-3 p-4 text-left transition-colors duration-fast hover:border-hairline-strong",
        selected && "border-cosmic/70 bg-cosmic/[0.05] shadow-[inset_0_0_0_1px_var(--c-cosmic)]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-md font-semibold text-fg">{TIER_NAME[tier]}</span>
        <span className={cn("size-3.5 rounded-full border", selected ? "border-cosmic bg-cosmic" : "border-fg-muted")} aria-hidden="true" />
      </div>
      {info ? (
        <>
          <p className="text-sm text-fg-secondary">{info.description}</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <div>
              <dt className="text-fg-secondary">Signals</dt>
              <dd className="num text-sm text-fg">{formatInt(info.n_signals)}</dd>
            </div>
            <div>
              <dt className="text-fg-secondary">Stars</dt>
              <dd className="num text-sm text-fg">{formatInt(info.n_stars)}</dd>
            </div>
            <div>
              <dt className="text-fg-secondary">Planet-like / FP-like</dt>
              <dd className="num text-sm text-fg">
                {formatInt(info.n_pos)} / {formatInt(info.n_neg)}
              </dd>
            </div>
            <div>
              <dt className="text-fg-secondary">Label conflicts</dt>
              <dd className="num text-sm text-fg">{formatInt(info.n_label_conflicts)}</dd>
            </div>
            <div>
              <dt className="text-fg-secondary">To download</dt>
              <dd className="num text-sm text-fg">
                {info.n_stars_missing ? `${formatInt(info.n_stars_missing)} stars · ${formatBytes(info.est_download_bytes)}` : "nothing"}
              </dd>
            </div>
            <div>
              <dt className="text-fg-secondary">Estimated time</dt>
              <dd className="num text-sm text-fg">{minutes(info.est_minutes)}</dd>
            </div>
          </dl>
          <p className="mt-auto text-2xs text-fg-secondary">
            download {minutes(info.est_download_minutes)} · processing {minutes(info.est_process_minutes)}
          </p>
        </>
      ) : (
        <p className="text-sm text-fg-secondary">
          Choose the target number of labelled signals yourself (whole stars, class-balanced where possible). The server gives no size estimate for custom builds.
        </p>
      )}
    </button>
  );
}

export interface BuildDatasetProps {
  /** Called when the build job finishes successfully, with the new dataset id. */
  onBuilt?: (datasetId: number) => void;
  /** Called as soon as the job is accepted (to select the new dataset). */
  onStarted?: (datasetId: number | null, job: JobOut) => void;
  existingNames: string[];
}

export function BuildDataset({ onBuilt, onStarted, existingNames }: BuildDatasetProps) {
  const [labelMode, setLabelMode] = useState<LabelMode>("astronet_dr24");
  const [tier, setTier] = useState<DatasetTier>("pilot");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [seed, setSeed] = useState<number | null>(42);
  const [excludeConflicts, setExcludeConflicts] = useState(true);
  const [maxSignals, setMaxSignals] = useState<number | null>(500);
  const [detrend, setDetrend] = useState<DetrendMethod>("spline");
  const [downloadMissing, setDownloadMissing] = useState(true);
  const [job, setJob] = useState<JobOut | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const tiers = useDatasetTiers(labelMode);
  const build = useBuildDataset();
  const tierInfo = (t: DatasetTier) => tiers.data?.find((x) => x.tier === t) ?? null;
  const chosen = tierInfo(tier);

  // Suggest a name until the user types one.
  const suggested = `${TIER_NAME[tier]} ${labelMode === "astronet_dr24" ? "DR24" : "KOI"}${tier === "custom" && maxSignals ? ` ${maxSignals}` : ""}`;
  useEffect(() => {
    if (!nameTouched) setName(suggested);
  }, [suggested, nameTouched]);

  const trimmed = name.trim();
  const errors = {
    name: !trimmed ? "Give the dataset a name." : trimmed.length > 128 ? "At most 128 characters." : existingNames.includes(trimmed) ? "A dataset with this name already exists." : null,
    seed: seed === null || seed < 0 || !Number.isInteger(seed) ? "A whole number ≥ 0." : null,
    maxSignals: tier === "custom" && (maxSignals === null || maxSignals < 1 || !Number.isInteger(maxSignals)) ? "Required for a custom dataset: a whole number ≥ 1." : null,
  };
  const valid = !errors.name && !errors.seed && !errors.maxSignals;

  const submit = () => {
    setSubmitted(true);
    if (!valid) return;
    const body: DatasetCreate = {
      name: trimmed,
      tier,
      label_mode: labelMode,
      split_seed: seed ?? 42,
      exclude_conflicts: excludeConflicts,
      max_signals: tier === "custom" ? maxSignals : null,
      pipeline: { detrend_method: detrend },
      download_missing: downloadMissing,
    };
    build.mutate(body, {
      onSuccess: (j) => {
        setJob(j);
        setNameTouched(false);
        onStarted?.(datasetIdOfJob(j), j);
      },
    });
  };

  const bigBuild = chosen && (chosen.est_minutes > 15 || chosen.n_stars_missing > 200);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-fg" id="label-mode-label">
          Label mode
        </span>
        <SegmentedControl<LabelMode>
          aria-label="Label mode"
          value={labelMode}
          onChange={setLabelMode}
          options={LABEL_MODES.map((m) => ({ value: m.value, label: m.label }))}
        />
        <p className="text-xs text-fg-secondary">{LABEL_MODES.find((m) => m.value === labelMode)?.help}</p>
      </div>

      <div role="radiogroup" aria-label="Dataset tier" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {TIER_ORDER.map((t) =>
          t !== "custom" && tiers.isLoading ? (
            <Card key={t} className="flex flex-col gap-3">
              <Skeleton height={16} width="40%" />
              <Skeleton height={10} />
              <Skeleton height={10} width="80%" />
              <Skeleton height={48} />
            </Card>
          ) : (
            <TierCard key={t} tier={t} info={t === "custom" ? null : tierInfo(t)} selected={tier === t} onSelect={() => setTier(t)} />
          ),
        )}
      </div>
      {tiers.isError ? <ApiErrorBanner error={tiers.error} title="Tier estimates are unavailable" onRetry={() => void tiers.refetch()} /> : null}
      {chosen ? <p className="-mt-2 text-2xs text-fg-secondary">Estimate basis: {chosen.estimate_basis}</p> : null}

      <Card>
        <form
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
          aria-label="Build a dataset"
        >
          <Field label="Name" required error={submitted || nameTouched ? errors.name : null} className="md:col-span-2">
            <Input
              value={name}
              maxLength={128}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
            />
          </Field>
          <Field label="Split seed" help="Seeds the tier's star selection and the star-level 80/10/10 split." error={submitted ? errors.seed : null}>
            <NumberInput value={seed} onChange={setSeed} min={0} step={1} />
          </Field>
          <Field label="Detrending" help="Spline (default, robust) or Savitzky–Golay filter before folding.">
            <SegmentedControl<DetrendMethod>
              aria-label="Detrending method"
              value={detrend}
              onChange={setDetrend}
              options={[
                { value: "spline", label: "Spline" },
                { value: "savgol", label: "Savitzky–Golay" },
              ]}
            />
          </Field>
          {tier === "custom" ? (
            <Field label="Max signals" required help="Target number of labelled signals." error={errors.maxSignals}>
              <NumberInput value={maxSignals} onChange={setMaxSignals} min={1} step={50} allowEmpty />
            </Field>
          ) : null}
          <div className="flex flex-col gap-3 md:col-span-2">
            <Switch
              checked={excludeConflicts}
              onChange={setExcludeConflicts}
              label="Exclude label conflicts"
              description="Drop signals whose Autovetter label and KOI disposition disagree (recommended)."
            />
            <Switch
              checked={downloadMissing}
              onChange={setDownloadMissing}
              label="Download missing light curves"
              description="Fetch light curves that are not cached yet from NASA MAST during the build. Off: those stars are skipped."
            />
          </div>
          {bigBuild ? (
            <Banner tone="warn" className="md:col-span-2" title={`This is a large build (${minutes(chosen?.est_minutes)})`}>
              It downloads and processes {formatInt(chosen?.n_signals)} signals. It runs in the background; you can follow it in the job tray and cancel at any time.
            </Banner>
          ) : null}
          {build.isError ? <ApiErrorBanner className="md:col-span-2" error={build.error} /> : null}
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <Button type="submit" variant="primary" icon={<Hammer />} loading={build.isPending} disabled={submitted && !valid}>
              Build dataset
            </Button>
            <span className="flex items-center gap-1.5 text-xs text-fg-secondary">
              <Info className="size-3.5" aria-hidden="true" />
              Splits are made by star, so no star appears in two splits.
            </span>
          </div>
        </form>
      </Card>

      {job ? (
        <JobProgress
          jobId={job.id}
          initial={job}
          onDismiss={() => setJob(null)}
          onDone={(j) => {
            const id = datasetIdOfJob(j);
            if (j.status === "succeeded" && id !== null) onBuilt?.(id);
          }}
        />
      ) : null}
    </div>
  );
}
