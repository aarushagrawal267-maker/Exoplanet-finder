/**
 * Transit Analysis — search, fit and vet a transit on a catalogue star or an uploaded light curve:
 *  1. light curve (stages, quarters, predicted transits, fold);
 *  2. BLS period search with peaks and aliases;
 *  3. transit fit with the model curve, odd/even and secondary-eclipse tests, individual transits,
 *     data quality, and catalogue vs measured vs estimated values with provenance;
 *  4. a SYNTHETIC injection–recovery test of the pipeline's sensitivity on this star.
 * Measured values come from this app's pipeline; estimates state their assumptions.
 */
import { CheckCircle2, CircleSlash2, FlaskConical, Play, Search, TriangleAlert } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useBls, useInjection, useTransitAnalysis } from "@/api/endpoints/analysis";
import { useTarget } from "@/api/endpoints/targets";
import { useUpload } from "@/api/endpoints/uploads";
import type { BlsIn, BlsOut, InjectionIn, InjectionOut, PValue, SignalOut, TransitIn, TransitOut } from "@/api/schemas";
import { PeriodogramPlot } from "@/components/charts/PeriodogramPlot";
import { PhaseFoldPlot } from "@/components/charts/PhaseFoldPlot";
import { TransitDepthsPlot, type TransitDepthPoint } from "@/components/charts/TransitDepthsPlot";
import { ElapsedProgress } from "@/components/jobs/ElapsedProgress";
import { derivedLabel, displayUnit, pairs, toQualityReport } from "@/components/science/adapters";
import { EphemerisChooser, isEphemerisComplete } from "@/components/science/EphemerisChooser";
import { EphemerisLine, LightCurveViewer } from "@/components/science/LightCurveViewer";
import { ProvenanceTable, type ProvenanceCell, type ProvenanceRow } from "@/components/science/ProvenanceTable";
import { QualityReport } from "@/components/science/QualityReport";
import { signalName, StarSignalPicker } from "@/components/science/StarSignalPicker";
import { UploadFlow } from "@/components/science/UploadFlow";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { NumberInput } from "@/components/ui/NumberInput";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";
import { Readout } from "@/components/ui/Readout";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { cn } from "@/lib/cn";
import { formatBkjd, formatDays, formatHours, formatInt, formatNumber, formatPercent, formatPpm, formatSigma, isFiniteNumber } from "@/lib/format";
import { useSourceState } from "../_shared/sourceState";

type Dict = Record<string, unknown>;
const n = (d: Dict | null | undefined, k: string): number | null => {
  const v = d?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-1.5 text-sm text-fg-secondary" aria-label="Warnings">
      {items.map((w) => (
        <li key={w} className="flex gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  );
}

function Verdict({ ok, good, bad }: { ok: boolean; good: ReactNode; bad: ReactNode }) {
  return ok ? (
    <Badge tone="cosmic" icon={<CheckCircle2 aria-hidden="true" />}>
      {good}
    </Badge>
  ) : (
    <Badge tone="warn" icon={<TriangleAlert aria-hidden="true" />}>
      {bad}
    </Badge>
  );
}

/* ------------------------------------------------------------------ BLS */

function BlsResults({ bls, catalogPeriod, onUse }: { bls: BlsOut; catalogPeriod?: number | null; onUse: () => void }) {
  const pg = pairs(bls.periods, bls.power_norm);
  const b = bls.best;
  const markers = catalogPeriod ? [{ period: catalogPeriod, label: "catalogue P" }] : [];
  return (
    <div className="flex flex-col gap-5">
      <PeriodogramPlot periods={pg.x} power={pg.y} bestPeriod={b.period} markers={markers} powerLabel="Normalised BLS power (SDE)" height={280} />
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        <Readout size="sm" label="Period" value={formatDays(b.period, { unit: false })} unit="d" provenance="measured" provenanceSource={b.source} />
        <Readout size="sm" label="Epoch T₀" value={formatBkjd(b.epoch, { unit: false, digits: 4 })} unit={bls.source.time_system} />
        <Readout size="sm" label="Duration" value={formatHours(b.duration_hours, { unit: false })} unit="h" />
        <Readout size="sm" label="Depth" value={formatPpm(b.depth_ppm, { unit: false })} unit="ppm" error={isFiniteNumber(b.depth_err_ppm) ? formatPpm(b.depth_err_ppm, { unit: false }) : undefined} />
        <Readout size="sm" label="SNR" value={formatNumber(b.snr, { digits: 1 })} caption={`SDE ${formatNumber(b.sde, { digits: 1 })}`} />
        <Readout size="sm" label="Transits" value={`${formatInt(b.n_transits)} / ${formatInt(b.n_transits_expected)}`} caption="with data / expected" />
      </div>
      <div className="relative overflow-x-auto rounded-md border border-hairline">
        <table className="w-full text-sm" aria-label="Strongest BLS peaks">
          <thead className="bg-space">
            <tr>
              {["Rank", "Period", "SDE", "Relation to best", "Grid"].map((h, i) => (
                <th key={h} scope="col" className={cn("eyebrow h-9 whitespace-nowrap px-3 font-medium text-fg-secondary", i === 0 || i >= 3 ? "text-left" : "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bls.peaks.map((p) => (
              <tr key={p.rank} className={cn("border-t border-hairline", p.is_best && "bg-cosmic/[0.06]")}>
                <td className="num px-3 py-2 text-fg">{p.rank}</td>
                <td className="num whitespace-nowrap px-3 py-2 text-right text-fg">{formatDays(p.period)}</td>
                <td className="num px-3 py-2 text-right text-fg">{formatNumber(p.sde, { digits: 1 })}</td>
                <td className="px-3 py-2">
                  {p.is_best ? <Badge tone="cosmic">Best</Badge> : p.alias_of_best ? <Badge tone="warn">Alias · {p.alias_of_best}</Badge> : <span className="text-fg-secondary">independent</span>}
                </td>
                <td className="px-3 py-2 text-xs text-fg-secondary">{p.refined ? "refined" : "coarse"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Warnings items={bls.warnings} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
        <p className="num text-xs text-fg-secondary">
          {formatInt(bls.search.n_periods_searched)} trial periods, {formatDays(bls.search.min_period, { digits: 2 })} – {formatDays(bls.search.max_period, { digits: 1 })}, baseline{" "}
          {formatDays(bls.search.baseline_days, { digits: 1 })} · {formatInt(bls.search.n_points)} points · {formatNumber(bls.compute_ms / 1000, { digits: 1 })} s{bls.cached ? " (cached)" : ""}
        </p>
        <Button size="sm" variant="secondary" onClick={onUse}>
          Fit a transit with this ephemeris
        </Button>
      </div>
    </div>
  );
}

function BlsPanel({ request, setRequest, bls, ready, catalogPeriod, onUse }: {
  request: BlsIn | null;
  setRequest: (r: BlsIn) => void;
  bls: ReturnType<typeof useBls>;
  ready: BlsIn["source"] | null;
  catalogPeriod?: number | null;
  onUse: () => void;
}) {
  const [minP, setMinP] = useState<number | null>(null);
  const [maxP, setMaxP] = useState<number | null>(null);
  const invalid = minP !== null && maxP !== null && maxP <= minP;
  return (
    <Card>
      <CardHeader
        eyebrow="02 · Period search"
        title="Box Least Squares periodogram"
        description="Searches the flattened light curve for the strongest periodic box-shaped dip. Peaks at P/2, 2P or P/3 are flagged as aliases."
        actions={<ProvenanceChip kind="measured" />}
      />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || invalid) return;
          setRequest({ source: ready, min_period: minP, max_period: maxP });
        }}
      >
        <Field label="Shortest period" className="w-[150px]" error={invalid ? "Must be below the longest period." : undefined}>
          <NumberInput value={minP} onChange={setMinP} min={0.1} step={0.1} precision={2} unit="d" allowEmpty hideSteppers placeholder="0.50" />
        </Field>
        <Field label="Longest period" className="w-[150px]">
          <NumberInput value={maxP} onChange={setMaxP} min={0.2} step={1} precision={1} unit="d" allowEmpty hideSteppers placeholder="½ baseline" />
        </Field>
        <Button type="submit" variant="primary" icon={<Search />} disabled={!ready || invalid} loading={bls.isFetching} className="mb-0.5">
          Run BLS search
        </Button>
      </form>
      <div className="mt-5">
        {!request ? (
          <p className="text-sm text-fg-secondary">{ready ? "Run the search to see the periodogram. Leave the range empty for 0.5 d to half the observing baseline." : "Choose a light curve first."}</p>
        ) : bls.isFetching && !bls.data ? (
          <ElapsedProgress label="Searching trial periods…" hint="Typically 5–10 s for a 4-year Kepler light curve; cached afterwards." />
        ) : bls.isError ? (
          <ApiErrorBanner error={bls.error} onRetry={() => void bls.refetch()} />
        ) : bls.data ? (
          <BlsResults bls={bls.data} catalogPeriod={catalogPeriod} onUse={onUse} />
        ) : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ transit fit */

function toCell(v: PValue | null | undefined): ProvenanceCell | null {
  return v ? { value: v.value, err: v.err ?? null, source: [v.source, v.note].filter(Boolean).join(" — ") || undefined } : null;
}

const TIME_UNITS = new Set(["BKJD", "BTJD", "BJD", "days", "d (relative)"]);

/** Fraction digits for a comparison row: [value, uncertainty]. */
function digitsFor(unit: string): [number, number] {
  if (unit === "d") return [5, 5];
  if (TIME_UNITS.has(unit)) return [4, 5];
  if (unit === "ppm" || unit === "K") return [0, 0];
  if (unit === "h") return [2, 3];
  if (unit === "" || unit === "sigma") return [1, 1];
  return [2, 2];
}

function TransitResults({ t }: { t: TransitOut }) {
  const fit = t.fit as Dict;
  const oe = t.odd_even as Dict;
  const sec = t.secondary as Dict;
  const snr = t.snr as Dict;
  const noise = t.noise as Dict;
  const count = t.transit_count as Dict;
  const folded = pairs(t.folded.phase, t.folded.flux);
  const bins = pairs(t.folded.binned.phase, t.folded.binned.flux);
  const model = t.model_curve ? pairs(t.model_curve.phase, t.model_curve.flux) : null;
  const duration = n(fit, "duration_hours") ?? t.ephemeris.duration_hours;
  const oeSigma = n(oe, "diff_sigma");
  const secSigma = n(sec, "significance_sigma");
  const quality = toQualityReport(t.quality);
  const rows: ProvenanceRow[] = t.comparison.map((r) => ({
    quantity: r.quantity,
    unit: displayUnit(r.unit),
    digits: digitsFor(r.unit)[0],
    errDigits: digitsFor(r.unit)[1],
    noAgreement: TIME_UNITS.has(r.unit),
    catalogue: toCell(r.catalogue),
    measured: toCell(r.measured),
    estimate: toCell(r.estimate),
    note: r.estimate?.note ?? undefined,
  }));
  const transits: TransitDepthPoint[] = t.individual_transits.map((x) => ({
    index: Number((x as Dict).index ?? 0),
    epoch: Number((x as Dict).epoch ?? 0),
    depth_ppm: n(x as Dict, "depth_ppm"),
    err_ppm: n(x as Dict, "err_ppm"),
  }));
  const derived = Object.entries(t.derived);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="eyebrow mb-2 text-fg-secondary">Folded light curve and trapezoid model</div>
          <PhaseFoldPlot
            phase={folded.x}
            flux={folded.y}
            binned={{ phase: bins.x, flux: bins.y }}
            model={model ? { phase: model.x, flux: model.y, label: "Trapezoid model" } : undefined}
            durationHours={duration}
            zoomDurations={(t.folded.binned.window_days * 24) / duration}
            units="ppm"
            height={320}
          />
          <p className="mt-2 text-xs text-fg-secondary">
            Points: flattened cadences · line: binned median · dashed violet: {t.model_curve?.model ?? "model"}. Shaded: fitted T₁₄.
          </p>
        </div>
        <div className="grid grid-cols-2 content-start gap-x-6 gap-y-5">
          <Readout label="Depth" value={formatPpm(n(fit, "depth_ppm"), { unit: false })} unit="ppm" error={n(fit, "depth_err_ppm") !== null ? formatPpm(n(fit, "depth_err_ppm"), { unit: false }) : undefined} provenance="measured" provenanceSource={String(fit.source ?? "trapezoid fit")} />
          <Readout label="Duration T₁₄" value={formatHours(duration, { unit: false })} unit="h" error={n(fit, "duration_err_hours") !== null ? formatHours(n(fit, "duration_err_hours"), { unit: false, digits: 3 }) : undefined} provenance="measured" />
          <Readout size="sm" label="Ingress" value={formatHours(n(fit, "ingress_hours"), { unit: false })} unit="h" caption={n(fit, "shape_ratio") !== null ? `ingress/T₁₄ = ${formatNumber(n(fit, "shape_ratio"), { digits: 2 })} (${(n(fit, "shape_ratio") ?? 0) > 0.4 ? "V-shaped" : "U/box-shaped"})` : undefined} />
          <Readout size="sm" label="SNR" value={formatNumber(n(snr, "snr"), { digits: 1 })} caption={`noise ${formatPpm(n(snr, "noise_ppm"))} per transit`} />
          <Readout size="sm" label="Transits" value={`${formatInt(n(count, "observed"))} / ${formatInt(n(count, "expected"))}`} caption="with data / expected" />
          <Readout size="sm" label="Fit χ²ᵣ" value={formatNumber(n(fit, "chi2_red"), { digits: 2 })} caption={fit.converged ? "converged" : "did not converge"} tone={fit.converged ? "default" : "warn"} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card raised>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-fg">Odd / even depths</span>
            {oeSigma !== null ? <Verdict ok={oeSigma < 3} good="Consistent" bad={`Differ by ${formatSigma(oeSigma)}`} /> : null}
          </div>
          <KeyValueList
            dense
            items={[
              { key: "odd", label: "Odd transits", value: `${formatPpm(n(oe, "depth_odd_ppm"))} ± ${formatPpm(n(oe, "err_odd"), { unit: false })}`, provenance: "measured" },
              { key: "even", label: "Even transits", value: `${formatPpm(n(oe, "depth_even_ppm"))} ± ${formatPpm(n(oe, "err_even"), { unit: false })}`, provenance: "measured" },
              { key: "diff", label: "Difference", value: formatSigma(oeSigma) },
            ]}
          />
          <p className="mt-2 text-xs text-fg-secondary">Unequal odd and even depths (≥ 3σ) suggest an eclipsing binary seen at half its true period.</p>
        </Card>
        <Card raised>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-fg">Secondary eclipse</span>
            {secSigma !== null ? <Verdict ok={secSigma < 3} good="None detected" bad={`Detected at ${formatSigma(secSigma)}`} /> : null}
          </div>
          <KeyValueList
            dense
            items={[
              { key: "depth", label: "Depth at phase " + formatNumber(n(sec, "phase"), { digits: 2 }), value: `${formatPpm(n(sec, "depth_ppm"))} ± ${formatPpm(n(sec, "err_ppm"), { unit: false })}`, provenance: "measured" },
              { key: "sig", label: "Significance", value: formatSigma(secSigma) },
              { key: "ratio", label: "Secondary / primary", value: n(sec, "depth_ppm") !== null && n(fit, "depth_ppm") ? formatPercent((n(sec, "depth_ppm") as number) / (n(fit, "depth_ppm") as number), { digits: 2 }) : "—" },
            ]}
          />
          <p className="mt-2 text-xs text-fg-secondary">A significant dip half an orbit later is typical of an eclipsing binary (or a hot, self-luminous planet).</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="eyebrow text-fg-secondary">Individual transits</span>
            <span className="num text-xs text-fg-secondary">
              {formatInt(transits.length)} shown · out-of-transit scatter {formatPpm(n(noise, "oot_scatter_ppm"))} · red-noise β {formatNumber(n(noise, "red_noise_beta"), { digits: 2 })}
            </span>
          </div>
          {transits.length ? <TransitDepthsPlot transits={transits} meanDepth={n(snr, "depth_ppm") ?? n(fit, "depth_ppm")} timeSystem={t.source.time_system} /> : <p className="text-sm text-fg-secondary">No individual transit had enough in-transit data.</p>}
        </div>
        {quality ? <QualityReport report={quality} /> : null}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="eyebrow text-fg-secondary">Catalogue vs measured vs estimate</span>
          {!t.signal_id ? <span className="text-xs text-fg-secondary">Select a catalogue signal to fill the catalogue column.</span> : null}
        </div>
        <ProvenanceTable rows={rows} caption="Catalogue, measured and estimated transit parameters" />
      </div>

      {derived.length ? (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="eyebrow text-fg-secondary">Derived estimates</span>
            <ProvenanceChip kind="estimate" size="xs" />
          </div>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {derived.map(([key, v]) => (
              <li key={key} className="rounded-lg border border-dashed border-signal-uncertain/40 p-3">
                <div className="text-xs text-fg-secondary">{derivedLabel(key)}</div>
                <div className="num mt-1 text-md text-fg">
                  {formatNumber(v.value, { digits: v.unit === "K" ? 0 : v.unit === "AU" ? 4 : 2 })}
                  {isFiniteNumber(v.err) ? <span className="text-sm text-fg-secondary"> ± {formatNumber(v.err, { digits: 3 })}</span> : null} <span className="text-sm text-fg-secondary">{displayUnit(v.unit)}</span>
                </div>
                <p className="mt-1 text-xs text-fg-secondary">{v.source}</p>
                {v.note ? <p className="mt-1 text-xs text-fg-secondary">{v.note}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {t.masked_other_signals.length ? (
        <div className="text-sm text-fg-secondary">
          <span className="eyebrow mr-2">Masked other signals</span>
          {t.masked_other_signals.map((m) => (
            <EphemerisLine key={m.label} ephemeris={m} className="mt-1" />
          ))}
        </div>
      ) : null}
      <Warnings items={t.warnings} />
      <p className="num text-xs text-fg-secondary">
        Pipeline v{t.pipeline_version} · {formatNumber(t.compute_ms / 1000, { digits: 1 })} s{t.cached ? " (cached)" : ""}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ injection */

function InjectionResults({ r }: { r: InjectionOut }) {
  const pg = pairs(r.periodogram.periods, r.periodogram.power);
  const fold = pairs(r.folded_injected.phase, r.folded_injected.flux);
  const c = r.criteria;
  const row = (label: string, inj: ReactNode, rec: ReactNode) => (
    <tr className="border-t border-hairline">
      <th scope="row" className="px-3 py-2 text-left font-normal text-fg-secondary">
        {label}
      </th>
      <td className="num px-3 py-2 text-right text-fg">{inj}</td>
      <td className="num px-3 py-2 text-right text-fg">{rec}</td>
    </tr>
  );
  return (
    <div className="flex flex-col gap-5">
      <Banner tone="fixture-model" title="SYNTHETIC — not an observation">
        {r.label}
      </Banner>
      <div className="flex flex-wrap items-center gap-2">
        {r.recovered_ok ? (
          <Badge tone="cosmic" size="md" icon={<CheckCircle2 aria-hidden="true" />}>
            Injected signal recovered
          </Badge>
        ) : (
          <Badge tone="warn" size="md" icon={<CircleSlash2 aria-hidden="true" />}>
            Not recovered
          </Badge>
        )}
        <Badge tone={c.period_match ? "cosmic" : "warn"}>Period {c.period_match ? "matches" : "differs"} (±{formatPercent(c.period_rel_tol, { digits: 0 })})</Badge>
        <Badge tone={c.epoch_match ? "cosmic" : "warn"}>
          Epoch offset {formatHours(c.epoch_offset_hours)} (tol. {formatHours(c.epoch_tol_hours, { digits: 1 })})
        </Badge>
        {c.alias_of_injected ? <Badge tone="warn">Alias · {c.alias_of_injected}</Badge> : null}
        {c.matches_known_signal ? <Badge tone="warn">Locked onto {c.matches_known_signal}</Badge> : null}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="relative overflow-x-auto rounded-md border border-hairline">
          <table className="w-full text-sm" aria-label="Injected versus recovered parameters">
            <thead className="bg-space">
              <tr>
                <th scope="col" className="eyebrow h-9 px-3 text-left font-medium text-fg-secondary">
                  Parameter
                </th>
                <th scope="col" className="eyebrow h-9 px-3 text-right font-medium text-nebula">
                  Injected
                </th>
                <th scope="col" className="h-9 px-3 text-right">
                  <ProvenanceChip kind="measured" label="Recovered" />
                </th>
              </tr>
            </thead>
            <tbody>
              {row("Period", formatDays(r.injected.period_days), formatDays(r.recovered.period_days))}
              {row("Epoch", formatBkjd(r.injected.epoch), formatBkjd(r.recovered.epoch))}
              {row("Duration", formatHours(r.injected.duration_hours), formatHours(r.recovered.duration_hours))}
              {row("Depth", formatPpm(r.injected.depth_ppm), `${formatPpm(r.recovered.depth_ppm)}${c.depth_ratio ? ` (×${formatNumber(c.depth_ratio, { digits: 2 })})` : ""}`)}
              {row("SNR", formatNumber(r.injected.snr_at_injected_ephemeris, { digits: 1 }), formatNumber(r.recovered.snr, { digits: 1 }))}
              {row("Transits in data", formatInt(r.injected.n_transits_in_data), formatInt(r.recovered.n_transits))}
            </tbody>
          </table>
          <p className="border-t border-hairline px-3 py-2 text-xs text-fg-secondary">
            {r.recovered.method}. {formatInt(r.n_cadences_masked)} cadences of {formatInt(r.masked_known_signals.length)} known signal(s) masked.
          </p>
        </div>
        <div className="min-w-0">
          <div className="eyebrow mb-2 text-fg-secondary">Injected transit, folded on the injected period</div>
          <PhaseFoldPlot phase={[]} flux={[]} binned={{ phase: fold.x, flux: fold.y }} durationHours={r.injected.duration_hours} zoomDurations={(r.folded_injected.window_days * 24) / r.injected.duration_hours} units="ppm" height={240} ariaLabel="Binned light curve folded on the injected (synthetic) period" />
        </div>
      </div>
      <div>
        <div className="eyebrow mb-2 text-fg-secondary">Blind BLS search of the injected light curve</div>
        <PeriodogramPlot periods={pg.x} power={pg.y} bestPeriod={r.recovered.period_days} markers={[{ period: r.injected.period_days, label: "injected P" }]} powerLabel="BLS power" height={240} />
      </div>
      <Warnings items={r.warnings} />
    </div>
  );
}

function InjectionPanel({ kepid, timeSystem }: { kepid: number; timeSystem: string }) {
  const [form, setForm] = useState<{ period: number | null; depth: number | null; duration: number | null; epoch: number | null }>({ period: 5.3, depth: 500, duration: 3, epoch: null });
  const [req, setReq] = useState<InjectionIn | null>(null);
  const inj = useInjection(req);
  const invalid = !(form.period && form.period > 0) || !(form.depth && form.depth > 0) || !(form.duration && form.duration > 0) || (form.period && form.duration ? form.duration >= form.period * 24 : false);
  return (
    <Card className="border-dashed border-nebula/50">
      <CardHeader
        eyebrow="04 · Sensitivity test"
        title={
          <span className="flex flex-wrap items-center gap-2">
            Injection–recovery
            <Badge tone="nebula" icon={<FlaskConical aria-hidden="true" />}>
              SYNTHETIC
            </Badge>
          </span>
        }
        description="Adds an artificial transit to a copy of this star's real light curve, then runs a blind BLS search to see whether the pipeline finds it again. Nothing is stored and the result is not an observation."
      />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          setReq({ kepid, period_days: form.period as number, depth_ppm: form.depth as number, duration_hours: form.duration as number, epoch: form.epoch, ingress_fraction: 0.1 });
        }}
      >
        <Field label="Period" className="w-[140px]">
          <NumberInput value={form.period} onChange={(v) => setForm({ ...form, period: v })} min={0.2} step={0.1} precision={3} unit="d" allowEmpty hideSteppers />
        </Field>
        <Field label="Depth" className="w-[140px]">
          <NumberInput value={form.depth} onChange={(v) => setForm({ ...form, depth: v })} min={1} step={10} precision={0} unit="ppm" allowEmpty hideSteppers />
        </Field>
        <Field label="Duration" className="w-[130px]">
          <NumberInput value={form.duration} onChange={(v) => setForm({ ...form, duration: v })} min={0.2} step={0.1} precision={2} unit="h" allowEmpty hideSteppers />
        </Field>
        <Field label="Epoch (optional)" className="w-[170px]">
          <NumberInput value={form.epoch} onChange={(v) => setForm({ ...form, epoch: v })} step={0.1} precision={3} unit={timeSystem} allowEmpty hideSteppers placeholder="auto" />
        </Field>
        <Button type="submit" variant="model" icon={<FlaskConical />} disabled={Boolean(invalid)} loading={inj.isFetching} className="mb-0.5">
          Inject and search
        </Button>
      </form>
      {invalid ? <p className="mt-2 text-xs text-warn">Enter a positive period, depth and duration (duration shorter than the period).</p> : null}
      <div className="mt-5">
        {!req ? null : inj.isFetching && !inj.data ? (
          <ElapsedProgress label="Injecting a synthetic transit and searching blind…" hint="About 5–10 s on a full Kepler light curve." />
        ) : inj.isError ? (
          <ApiErrorBanner error={inj.error} onRetry={() => void inj.refetch()} />
        ) : inj.data ? (
          <InjectionResults r={inj.data} />
        ) : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ page */

export default function TransitAnalysisPage() {
  const st = useSourceState();
  const target = useTarget(st.kind === "catalog" ? st.kepid : null);
  const upload = useUpload(st.kind === "upload" ? st.uploadId : null);
  const signal: SignalOut | null = target.data?.signals.find((s) => s.id === st.signalId) ?? null;
  const lcReady = st.kind === "catalog" ? target.data?.target.lc_status === "available" : Boolean(upload.data?.parsed);
  const timeSystem = st.kind === "upload" ? (upload.data?.parsed?.time_system ?? "BKJD") : "BKJD";
  const [blsReq, setBlsReq] = useState<BlsIn | null>(null);
  const [transitReq, setTransitReq] = useState<TransitIn | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const bls = useBls(blsReq && st.source && JSON.stringify(blsReq.source) === JSON.stringify(st.source) ? blsReq : null);
  const transit = useTransitAnalysis(transitReq && st.source && JSON.stringify(transitReq.source) === JSON.stringify(st.source) ? transitReq : null);
  const blsData = bls.data;

  // The ephemeris for the light-curve fold and the transit fit.
  const ephemeris = useMemo((): TransitIn["ephemeris"] | null => {
    if (st.eph === "catalog" && signal && signal.period_days && signal.epoch_bkjd !== null && signal.epoch_bkjd !== undefined && signal.duration_hours) {
      return { period_days: signal.period_days, epoch: signal.epoch_bkjd, duration_hours: signal.duration_hours, source: "catalogue", label: signal.signal_key };
    }
    if (st.eph === "bls" && blsData) {
      return { period_days: blsData.ephemeris.period_days, epoch: blsData.ephemeris.epoch, duration_hours: blsData.ephemeris.duration_hours, source: "measured", label: "BLS" };
    }
    if (st.eph === "manual" && isEphemerisComplete(st.manual)) {
      return { period_days: st.manual.period, epoch: st.manual.epoch, duration_hours: st.manual.durationHours, source: "manual", label: "Manual" };
    }
    return null;
  }, [st.eph, signal, blsData, st.manual]);

  const lcParams =
    ephemeris && st.eph !== "catalog"
      ? { period: ephemeris.period_days, epoch: ephemeris.epoch, durationHours: ephemeris.duration_hours }
      : { signalId: st.eph === "catalog" ? st.signalId : null };

  const runTransit = () => {
    setShowErrors(true);
    if (!st.source || !ephemeris) return;
    setTransitReq({ source: st.source, ephemeris, signal_id: st.kind === "catalog" ? st.signalId : null });
  };

  const hasSource = st.kind === "catalog" ? st.kepid !== null : Boolean(st.uploadId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Observe · 03"
        title="Transit Analysis"
        description="Search a light curve for periodic transits, fit the transit shape, and run the standard vetting checks — odd/even depths, secondary eclipse, individual events and data quality."
        meta={
          signal ? (
            <>
              <Badge tone="neutral" mono>
                {signal.signal_key}
              </Badge>
              <span className="text-sm text-fg-secondary">{signalName(signal)}</span>
            </>
          ) : null
        }
      />

      <Card>
        <CardHeader eyebrow="01 · Light curve" title="What to analyse" />
        <SegmentedControl<"catalog" | "upload">
          aria-label="Light-curve source"
          value={st.kind}
          onChange={st.setKind}
          options={[
            { value: "catalog", label: "Catalogue star" },
            { value: "upload", label: "Upload a file" },
          ]}
          className="mb-5"
        />
        {st.kind === "catalog" ? (
          <StarSignalPicker kepid={st.kepid} signalId={st.signalId} onChange={st.setStar} allowNoSignal />
        ) : (
          <UploadFlow uploadId={st.uploadId} onChange={st.setUpload} />
        )}
        {hasSource && (st.kind === "catalog" ? target.data : upload.data?.parsed) ? (
          <div className="mt-6 border-t border-hairline pt-5">
            <LightCurveViewer kepid={st.kind === "catalog" ? st.kepid : null} uploadId={st.kind === "upload" ? st.uploadId : null} {...lcParams} onDownloaded={() => void target.refetch()} />
          </div>
        ) : null}
      </Card>

      {!hasSource ? (
        <EmptyState
          title="Choose a light curve to analyse"
          description="Pick a catalogue star (and optionally one of its signals) or upload your own FITS / CSV light curve. The period search, transit fit and vetting checks appear here."
        />
      ) : !lcReady ? (
        <Banner tone="info" title={st.kind === "catalog" ? "Download the light curve to continue" : "Parse the upload to continue"}>
          {st.kind === "catalog" ? "The period search and transit fit need this star's cached Kepler light curve (download it above)." : "Confirm the columns and time system, then parse the file."}
        </Banner>
      ) : (
        <>
          <BlsPanel
            request={blsReq}
            setRequest={setBlsReq}
            bls={bls}
            ready={st.source}
            catalogPeriod={signal?.period_days}
            onUse={() => {
              st.setEph("bls");
              if (st.source && blsData) setTransitReq({ source: st.source, ephemeris: { period_days: blsData.ephemeris.period_days, epoch: blsData.ephemeris.epoch, duration_hours: blsData.ephemeris.duration_hours, source: "measured", label: "BLS" }, signal_id: st.kind === "catalog" ? st.signalId : null });
            }}
          />

          <Card>
            <CardHeader
              eyebrow="03 · Transit fit & vetting"
              title="Fit the transit"
              description="A trapezoid model is least-squares fitted to the folded light curve; the vetting checks run on the same ephemeris."
            />
            <EphemerisChooser
              mode={st.eph}
              onModeChange={st.setEph}
              manual={st.manual}
              onManualChange={st.setManual}
              catalogAvailable={Boolean(signal)}
              timeSystem={timeSystem}
              showErrors={showErrors}
              note={
                st.eph === "bls" && !blsData ? (
                  <p className="text-sm text-warn">Run the BLS search above first — its best period becomes the ephemeris.</p>
                ) : ephemeris ? (
                  <EphemerisLine ephemeris={{ ...ephemeris, label: ephemeris.label ?? "", depth_ppm: null, time_system: timeSystem }} />
                ) : null
              }
            />
            <div className="mt-4">
              <Button variant="primary" icon={<Play />} onClick={runTransit} disabled={!ephemeris && st.eph !== "manual"} loading={transit.isFetching}>
                Analyse transit
              </Button>
            </div>
            <div className="mt-6">
              {!transitReq ? null : transit.isFetching && !transit.data ? (
                <ElapsedProgress label="Fitting the transit and running vetting checks…" hint="A few seconds; cached afterwards." />
              ) : transit.isError ? (
                <ApiErrorBanner error={transit.error} onRetry={() => void transit.refetch()} />
              ) : transit.data ? (
                <TransitResults t={transit.data} />
              ) : null}
            </div>
          </Card>

          {st.kind === "catalog" && st.kepid !== null ? (
            <InjectionPanel kepid={st.kepid} timeSystem="BKJD" />
          ) : (
            <Card className="border-dashed border-nebula/40">
              <CardHeader eyebrow="04 · Sensitivity test" title="Injection–recovery" />
              <p className="text-sm text-fg-secondary">
                The synthetic injection–recovery test runs on cached Kepler light curves of catalogue stars only.{" "}
                <Link to="/transit?src=catalog" className={buttonClasses({ variant: "ghost", size: "sm", className: "px-1" })}>
                  Choose a catalogue star
                </Link>
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
