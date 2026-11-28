/**
 * Planet Detection — score a catalogue signal or an uploaded light curve with your trained models.
 *
 * 1. Source: a catalogue star + signal, or an upload (file → column mapping → time system → parse).
 * 2. Ephemeris: catalogue, a BLS search, or manual.
 * 3. Models: from `/api/models` (fixtures flagged, never preselected).
 * Results: one VerdictPanel per model (calibrated probability, uncertainty band vs threshold,
 * seen-in-split warning, fixture flag), the model input views, the data-quality report, NASA's own
 * labels side by side, measured features and every warning. A score is a research lead only.
 */
import { Radar } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "@/api/client";
import { useModels } from "@/api/endpoints/models";
import { usePredict } from "@/api/endpoints/predictions";
import { useSettings } from "@/api/endpoints/settings";
import { useTarget } from "@/api/endpoints/targets";
import { useUpload } from "@/api/endpoints/uploads";
import type { PredictIn, PredictResponse } from "@/api/schemas";
import { ElapsedProgress } from "@/components/jobs/ElapsedProgress";
import { toQualityReport } from "@/components/science/adapters";
import { CatalogueLabelsPanel } from "@/components/science/CatalogueLabels";
import { EphemerisChooser, isEphemerisComplete } from "@/components/science/EphemerisChooser";
import { EphemerisLine } from "@/components/science/LightCurveViewer";
import { defaultModelIds, ModelPicker, modelUsable, NoModelState } from "@/components/science/ModelPicker";
import { FeatureList, ModelInputViews, PredictionVerdict, WarningList } from "@/components/science/PredictionParts";
import { QualityReport } from "@/components/science/QualityReport";
import { signalName, StarSignalPicker } from "@/components/science/StarSignalPicker";
import { UploadFlow } from "@/components/science/UploadFlow";
import { ApiErrorBanner, hasErrorCode } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { formatInt, formatPercent } from "@/lib/format";
import { useSourceState } from "../_shared/sourceState";
import { predictionClass } from "../_shared/prediction";

function Results({ r }: { r: PredictResponse }) {
  const eph = r.ephemeris as { period_days?: number; epoch?: number; duration_hours?: number; depth_ppm?: number | null; source?: string; label?: string; time_system?: string };
  const quality = toQualityReport(r.quality);
  const nPlanet = r.results.filter((p) => predictionClass(p) === "planet").length;
  const ephemeris =
    eph.period_days && eph.epoch !== undefined && eph.duration_hours
      ? {
          period_days: eph.period_days,
          epoch: eph.epoch,
          duration_hours: eph.duration_hours,
          depth_ppm: eph.depth_ppm ?? null,
          source: (eph.source === "catalogue" || eph.source === "measured" || eph.source === "estimate" ? eph.source : "manual") as "catalogue" | "measured" | "estimate" | "manual",
          label: eph.label ?? "",
          time_system: eph.time_system ?? r.source.time_system,
        }
      : null;
  return (
    <section aria-labelledby="results-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow text-fg-secondary">Results</div>
          <h2 id="results-title" className="text-lg font-medium text-fg">
            {r.signal ? signalName(r.signal) : r.source.input_name}
          </h2>
          <p className="mt-1 text-sm text-fg-secondary">
            {r.source.input_name} · <span className="num">{formatInt(r.source.n_cadences)}</span> cadences · {r.source.time_system}
          </p>
        </div>
        {r.results.length > 1 ? (
          <Badge tone="nebula" size="md">
            {nPlanet} of {r.results.length} models read planet-like ({formatPercent(nPlanet / r.results.length, { digits: 0 })})
          </Badge>
        ) : null}
      </div>
      <Banner tone="info" title="How to read these scores">
        {r.disclaimer}
      </Banner>
      {ephemeris ? <EphemerisLine ephemeris={ephemeris} /> : null}

      <div className="flex flex-col gap-4">
        {r.results.map((p) => (
          <PredictionVerdict key={p.id} p={p} catalogLabels={r.catalog_labels} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader eyebrow="Model input" title="Global and local views" actions={<ProvenanceChip kind="measured" />} />
          <ModelInputViews views={r.views} period={ephemeris?.period_days} durationHours={ephemeris?.duration_hours} />
        </Card>
        <div className="flex min-w-0 flex-col gap-6">
          {quality ? <QualityReport report={quality} /> : null}
          <CatalogueLabelsPanel labels={r.catalog_labels} />
        </div>
      </div>

      <Card>
        <CardHeader eyebrow="Measured features" title="Physical features of the signal" description="Measured from the light curve by this app's pipeline; the logistic-regression and random-forest models use them as inputs." />
        <FeatureList features={r.features} />
      </Card>

      {r.warnings.length ? (
        <Card>
          <CardHeader eyebrow="Warnings" title={`${r.warnings.length} thing${r.warnings.length === 1 ? "" : "s"} to keep in mind`} />
          <WarningList warnings={r.warnings} />
        </Card>
      ) : null}
      <p className="num text-xs text-fg-secondary">Pipeline v{r.pipeline_version}</p>
    </section>
  );
}

export default function PlanetDetectionPage() {
  const st = useSourceState();
  const models = useModels(true);
  const settings = useSettings();
  const target = useTarget(st.kind === "catalog" ? st.kepid : null);
  const upload = useUpload(st.kind === "upload" ? st.uploadId : null);
  const predict = usePredict();
  const [showErrors, setShowErrors] = useState(false);
  const [showFixtures, setShowFixtures] = useState(false);
  const signal = target.data?.signals.find((s) => s.id === st.signalId) ?? null;
  const timeSystem = st.kind === "upload" ? (upload.data?.parsed?.time_system ?? "BKJD") : "BKJD";

  const all = models.data ?? [];
  const visible = all.filter((m) => showFixtures || !m.is_fixture);
  const urlModels = st.u.list("models").map(Number).filter((x) => Number.isInteger(x));
  const defaultId = typeof settings.data?.values.default_model_id === "number" ? (settings.data.values.default_model_id as number) : null;
  const selected = useMemo(() => {
    const valid = urlModels.filter((id) => all.some((m) => m.id === id && modelUsable(m).ok));
    return valid.length ? valid : defaultModelIds(all, defaultId);
  }, [urlModels.join(","), all, defaultId]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasFixtureSelected = all.some((m) => selected.includes(m.id) && m.is_fixture);
  useEffect(() => {
    if (hasFixtureSelected) setShowFixtures(true);
  }, [hasFixtureSelected]);

  const sourceReady = st.kind === "catalog" ? st.kepid !== null : Boolean(upload.data?.parsed);
  const ephReady = st.eph === "catalog" ? st.signalId !== null : st.eph === "bls" ? true : isEphemerisComplete(st.manual);
  const noModels = models.isSuccess && all.filter((m) => modelUsable(m).ok).length === 0;

  const run = () => {
    setShowErrors(true);
    if (!st.source || !sourceReady || !ephReady || !selected.length) return;
    const source: PredictIn["source"] =
      st.source.type === "catalog" ? { type: "catalog", kepid: st.source.kepid, signal_id: st.signalId } : { type: "upload", upload_id: st.source.upload_id };
    const body: PredictIn = {
      model_version_ids: selected,
      source,
      ephemeris_source: st.eph,
      ephemeris: st.eph === "manual" && isEphemerisComplete(st.manual) ? { period_days: st.manual.period, epoch: st.manual.epoch, duration_hours: st.manual.durationHours } : null,
      download_if_missing: true,
    };
    predict.mutate(body);
  };

  const needsDownload = st.kind === "catalog" && target.data && target.data.target.lc_status !== "available";
  const err = predict.error;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Detect · 01"
        title="Planet Detection"
        description="Score a catalogue signal or your own light curve with the models you trained. The answer is a calibrated probability that the signal looks planet-like — a research lead, never a confirmed discovery."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader eyebrow="01 · Signal" title="What to score" />
          <SegmentedControl<"catalog" | "upload">
            aria-label="Signal source"
            value={st.kind}
            onChange={st.setKind}
            options={[
              { value: "catalog", label: "Catalogue signal" },
              { value: "upload", label: "Upload a light curve" },
            ]}
            className="mb-5"
          />
          {st.kind === "catalog" ? (
            <StarSignalPicker kepid={st.kepid} signalId={st.signalId} onChange={st.setStar} allowNoSignal noSignalLabel="No catalogue signal — find one with BLS or enter an ephemeris" />
          ) : (
            <UploadFlow uploadId={st.uploadId} onChange={st.setUpload} />
          )}
          {needsDownload ? (
            <p className="mt-3 text-xs text-fg-secondary">This star&apos;s light curve is not cached yet: it is downloaded from NASA MAST when you score (a few seconds to a minute).</p>
          ) : null}
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader eyebrow="02 · Ephemeris" title="Period, epoch and duration" />
            <EphemerisChooser
              mode={st.eph}
              onModeChange={st.setEph}
              manual={st.manual}
              onManualChange={st.setManual}
              catalogAvailable={st.kind === "catalog" && st.signalId !== null}
              timeSystem={timeSystem}
              showErrors={showErrors}
              note={
                st.eph === "bls" ? (
                  <p className="text-xs text-fg-secondary">
                    BLS can lock onto aliases (P/2, 2P) or another planet of the star; inspect it in{" "}
                    <Link className="text-cosmic hover:underline" to={`/transit?${st.u.params.toString()}`}>
                      Transit Analysis
                    </Link>
                    .
                  </p>
                ) : st.eph === "catalog" && signal ? (
                  <p className="num text-xs text-fg-secondary">{signal.signal_key}</p>
                ) : null
              }
            />
          </Card>

          <Card>
            <CardHeader
              eyebrow="03 · Models"
              title="Which models score it"
              actions={all.some((m) => m.is_fixture) ? <Switch size="sm" checked={showFixtures} onChange={setShowFixtures} label={<span className="text-xs">Show fixtures</span>} /> : null}
            />
            {models.isPending ? (
              <Skeleton height={64} rounded="md" />
            ) : models.isError ? (
              <ApiErrorBanner error={models.error} onRetry={() => void models.refetch()} />
            ) : noModels ? (
              <NoModelState compact />
            ) : (
              <ModelPicker models={visible} value={selected} onChange={(ids) => st.u.set({ models: ids.join(",") })} />
            )}
            {showErrors && !selected.length && !noModels ? <p className="mt-2 text-xs text-danger">Choose at least one model.</p> : null}
          </Card>

          <div className="flex flex-col gap-3">
            <Button size="lg" variant="model" icon={<Radar />} onClick={run} loading={predict.isPending} disabled={noModels || !sourceReady}>
              Score {st.kind === "catalog" ? "signal" : "light curve"}
            </Button>
            {!sourceReady ? <p className="text-xs text-fg-secondary">{st.kind === "catalog" ? "Choose a star first." : "Upload and parse a light curve first."}</p> : null}
          </div>
        </div>
      </div>

      {predict.isPending ? (
        <ElapsedProgress
          label={needsDownload ? "Downloading the light curve from NASA MAST, then scoring…" : "Processing the light curve and scoring…"}
          hint={st.eph === "bls" ? "A BLS search adds 5–10 s on a full Kepler light curve." : "Usually a few seconds."}
        />
      ) : predict.isError ? (
        hasErrorCode(err, "no_model") ? (
          <NoModelState />
        ) : (
          <ApiErrorBanner
            error={err}
            title={
              hasErrorCode(err, "unscorable_signal")
                ? "This signal cannot be scored"
                : hasErrorCode(err, "lightcurve_unavailable")
                  ? "NASA MAST has no Kepler light curve for this star"
                  : err instanceof ApiError && err.status === 409
                    ? "Not ready to score"
                    : undefined
            }
            action={
              hasErrorCode(err, "unscorable_signal") ? (
                <Link to={`/transit?${st.u.params.toString()}`} className={buttonClasses({ size: "sm" })}>
                  Inspect in Transit Analysis
                </Link>
              ) : undefined
            }
          />
        )
      ) : predict.data ? (
        <Results r={predict.data} />
      ) : (
        <Card className="atmosphere overflow-hidden">
          <p className="text-sm text-fg-secondary">
            Results appear here: one verdict per model with its calibrated probability, uncertainty and decision threshold, the exact model inputs, a data-quality grade and NASA&apos;s own labels for comparison.
          </p>
        </Card>
      )}
    </div>
  );
}
