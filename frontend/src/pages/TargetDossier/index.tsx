/**
 * Target Dossier — everything known about one Kepler star (KIC id in the URL): stellar parameters
 * with provenance, every catalogue signal with NASA's labels and conflicts, the light curve (folded
 * on the selected signal), dataset memberships and predictions, plus the light-curve download.
 */
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, History, Radar, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "@/api/client";
import { useTarget } from "@/api/endpoints/targets";
import type { PValue, SignalOut, TargetDetailOut } from "@/api/schemas";
import { TransitIcon } from "@/components/brand/TransitIcon";
import { DownloadLightCurve } from "@/components/jobs/DownloadLightCurve";
import { displayUnit } from "@/components/science/adapters";
import { AvLabelBadge, CategoryBadge, KoiBadge, LcStatusBadge } from "@/components/science/CatalogueLabels";
import { LightCurveViewer } from "@/components/science/LightCurveViewer";
import { signalName } from "@/components/science/StarSignalPicker";
import { TargetSearchBox } from "@/components/science/TargetSearchBox";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ClassBadge } from "@/components/ui/ClassBadge";
import { DataTable, missingAsUndefined } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyValueList, type KeyValueItem } from "@/components/ui/KeyValueList";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatBytes, formatDays, formatHours, formatInt, formatKepid, formatNumber, formatPpm, formatRelativeTime } from "@/lib/format";
import { useUrlState } from "@/lib/urlState";
import { predictionClass } from "../_shared/prediction";

function pv(v: PValue | undefined, digits: number): KeyValueItem["value"] {
  if (!v || v.value === null) return "—";
  const unit = displayUnit(v.unit);
  return `${formatNumber(v.value, { digits })}${v.err ? ` ± ${formatNumber(v.err, { digits })}` : ""}${unit ? ` ${unit}` : ""}`;
}

function formatRaDec(ra: number | null | undefined, dec: number | null | undefined): string {
  if (ra === null || ra === undefined || dec === null || dec === undefined) return "—";
  return `${formatNumber(ra, { digits: 5, group: false })}°, ${formatNumber(dec, { digits: 5, signed: true, group: false })}°`;
}

function useSignalColumns(): ColumnDef<SignalOut>[] {
  return useMemo<ColumnDef<SignalOut>[]>(
    () => [
      {
        id: "signal",
        accessorFn: (r) => r.signal_key,
        header: "Signal",
        cell: (c) => (
          <span className="text-fg">
            {signalName(c.row.original)}
            {signalName(c.row.original) !== c.row.original.signal_key ? <span className="num ml-2 text-xs text-fg-secondary">{c.row.original.signal_key}</span> : null}
          </span>
        ),
      },
      { id: "period", accessorFn: missingAsUndefined((r: SignalOut) => r.period_days), header: "Period", meta: { numeric: true }, cell: (c) => formatDays(c.getValue<number | undefined>()) },
      { id: "dur", accessorFn: missingAsUndefined((r: SignalOut) => r.duration_hours), header: "T₁₄", meta: { numeric: true }, cell: (c) => formatHours(c.getValue<number | undefined>()) },
      { id: "depth", accessorFn: missingAsUndefined((r: SignalOut) => r.depth_ppm), header: "Depth", meta: { numeric: true }, cell: (c) => formatPpm(c.getValue<number | undefined>()) },
      { id: "snr", accessorFn: missingAsUndefined((r: SignalOut) => r.model_snr), header: "SNR", meta: { numeric: true }, cell: (c) => formatNumber(c.getValue<number | undefined>(), { digits: 1 }) },
      { id: "rp", accessorFn: missingAsUndefined((r: SignalOut) => r.planet_radius_re), header: "Rₚ (R⊕)", meta: { numeric: true }, cell: (c) => formatNumber(c.getValue<number | undefined>(), { digits: 2 }) },
      {
        id: "labels",
        header: "NASA labels",
        enableSorting: false,
        cell: (c) => {
          const s = c.row.original;
          return (
            <span className="inline-flex items-center gap-1.5">
              <CategoryBadge category={s.category} />
              {s.koi_disposition ? <KoiBadge disposition={s.koi_disposition} prefix /> : null}
              {s.av_training_set ? <AvLabelBadge label={s.av_training_set} prefix /> : null}
              {s.label_conflict ? (
                <Badge tone="warn" icon={<TriangleAlert aria-hidden="true" />}>
                  Conflict
                </Badge>
              ) : null}
            </span>
          );
        },
      },
    ],
    [],
  );
}

function Dossier({ d, signalId, onSignal }: { d: TargetDetailOut; signalId: number | null; onSignal: (id: number | null) => void }) {
  const t = d.target;
  const columns = useSignalColumns();
  const sel = d.signals.find((s) => s.id === signalId) ?? null;
  const st = d.stellar;
  const stellar: KeyValueItem[] = st
    ? [
        { key: "teff", label: "Effective temperature", value: pv(st.teff, 0), provenance: st.teff.provenance, hint: st.teff.source || undefined },
        { key: "radius", label: "Stellar radius", value: pv(st.radius, 3), provenance: st.radius.provenance, hint: st.radius.note ?? undefined },
        { key: "mass", label: "Stellar mass", value: pv(st.mass, 3), provenance: st.mass.provenance },
        { key: "logg", label: "Surface gravity log g", value: pv(st.logg, 3), provenance: st.logg.provenance },
        { key: "kepmag", label: "Kepler magnitude", value: pv(st.kepmag, 3), provenance: st.kepmag.provenance, hint: st.kepmag.source || undefined },
        { key: "radec", label: "RA, Dec (J2000)", value: formatRaDec(t.ra, t.dec), provenance: "catalogue" },
      ]
    : [{ key: "radec", label: "RA, Dec (J2000)", value: formatRaDec(t.ra, t.dec), provenance: "catalogue" }];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader eyebrow="Star" title="Stellar parameters" description={st ? undefined : "No stellar parameters in the catalogue snapshot for this star."} />
          <KeyValueList items={stellar} dense />
        </Card>
        <Card>
          <CardHeader eyebrow="Photometry" title="Kepler light curve" actions={<LcStatusBadge status={t.lc_status} />} />
          {t.lc_status === "available" ? (
            <KeyValueList
              dense
              items={[
                { key: "cad", label: "Long-cadence points", value: formatInt(t.lc_n_cadences) },
                { key: "q", label: `Quarters (${t.lc_quarters.length})`, value: t.lc_quarters.map((q) => `Q${q}`).join(" ") || "—" },
                { key: "size", label: "Local cache", value: t.lc_cached ? formatBytes(t.lc_cache_bytes) : "not cached" },
                { key: "upd", label: "Downloaded", value: formatRelativeTime(t.lc_updated_at), mono: false },
              ]}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-fg-secondary">
                {t.lc_status === "no_data"
                  ? "NASA MAST has no Kepler long-cadence light curve for this star."
                  : t.lc_status === "error"
                    ? `The last download failed${t.lc_error ? `: ${t.lc_error}` : "."}`
                    : t.lc_status === "queued" || t.lc_status === "downloading"
                      ? "A download is in progress."
                      : "The light curve has not been downloaded yet (a few seconds to a minute from NASA MAST)."}
              </p>
              {t.lc_status !== "no_data" ? <DownloadLightCurve kepid={t.kepid} label={t.lc_status === "error" ? "Retry download" : "Download light curve"} /> : null}
            </div>
          )}
        </Card>
      </div>

      <section aria-labelledby="signals-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 id="signals-title" className="font-display text-lg text-fg">
            Signals on this star <span className="num text-base text-fg-secondary">({d.signals.length})</span>
          </h2>
          <span className="text-xs text-fg-secondary">Select a signal to fold the light curve on its ephemeris.</span>
        </div>
        <DataTable
          caption="Catalogue signals on this star"
          data={d.signals}
          columns={columns}
          getRowId={(r) => String(r.id)}
          selectedRowId={signalId !== null ? String(signalId) : null}
          onRowClick={(r) => onSignal(r.id === signalId ? null : r.id)}
          showDensityToggle={false}
          maxHeight={360}
          emptyTitle="No catalogue signals"
          emptyDescription="This star has no DR24 TCE, KOI or confirmed planet in the local catalogue."
        />
      </section>

      <Card>
        <CardHeader
          eyebrow="Light curve"
          title={sel ? `Folded on ${signalName(sel)}` : "Whole light curve"}
          actions={
            sel ? (
              <div className="flex flex-wrap gap-2">
                <Link to={`/transit?kepid=${t.kepid}&signal=${sel.id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                  <TransitIcon aria-hidden="true" /> Analyse
                </Link>
                <Link to={`/detect?kepid=${t.kepid}&signal=${sel.id}`} className={buttonClasses({ variant: "model", size: "sm" })}>
                  <Radar aria-hidden="true" /> Score
                </Link>
              </div>
            ) : null
          }
        />
        {t.lc_status === "available" ? (
          <LightCurveViewer kepid={t.kepid} signalId={signalId} />
        ) : (
          <p className="text-sm text-fg-secondary">Download the light curve to view it here.</p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader eyebrow="Datasets" title="Dataset memberships" description={d.reserved_showcase ? "Reserved showcase star: always placed in test splits and never trained on." : undefined} />
          {d.datasets.length ? (
            <ul className="divide-y divide-hairline">
              {d.datasets.map((m, i) => (
                <li key={`${m.dataset_id}-${m.split ?? "excluded"}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <Link to={`/datasets?id=${m.dataset_id}`} className="text-sm text-fg hover:underline">
                    {m.dataset_name}
                  </Link>
                  <span className="flex items-center gap-2 text-xs text-fg-secondary">
                    <span className="num">{m.n_signals} signal{m.n_signals === 1 ? "" : "s"}</span>
                    {m.split ? <Badge tone={m.split === "test" ? "neutral" : m.split === "train" ? "warn" : "uncertain"}>{m.split}</Badge> : <Badge>excluded</Badge>}
                    {m.dataset_status && m.dataset_status !== "ready" ? <Badge tone="warn">{m.dataset_status}</Badge> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-secondary">Not part of any dataset yet.</p>
          )}
        </Card>
        <Card>
          <CardHeader
            eyebrow="Predictions"
            title="Recent predictions"
            actions={
              <Link to={`/predictions?kepid=${t.kepid}`} className={buttonClasses({ variant: "ghost", size: "sm" })}>
                <History aria-hidden="true" /> All
              </Link>
            }
          />
          {d.recent_predictions.length ? (
            <ul className="divide-y divide-hairline">
              {d.recent_predictions.map((p) => (
                <li key={p.id}>
                  <Link to={`/predictions?id=${p.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:bg-fg/[0.03]">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-fg">{p.signal_key ?? p.input_name}</span>
                      <span className="block truncate text-xs text-fg-secondary">
                        {p.model_name}
                        {p.is_fixture_model ? " (fixture)" : ""} · {formatRelativeTime(p.created_at)}
                        {p.seen_in_split ? ` · ${p.seen_in_split} split` : ""}
                      </span>
                    </span>
                    <ClassBadge cls={predictionClass(p)} probability={p.probability} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-fg-secondary">No predictions for this star yet.</p>
              <Link to={`/detect?kepid=${t.kepid}${sel ? `&signal=${sel.id}` : ""}`} className={buttonClasses({ variant: "model", size: "sm" })}>
                Score a signal <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          )}
          {d.recent_predictions.length ? (
            <p className="mt-3 text-xs text-fg-secondary">Scores are research leads — not confirmed discoveries.</p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

export default function TargetDossierPage() {
  const { kepid: raw = "" } = useParams();
  const navigate = useNavigate();
  const u = useUrlState();
  const valid = /^\d{1,9}$/.test(raw);
  const kepid = valid ? Number(raw) : null;
  const target = useTarget(kepid);
  const d = target.data;
  const signalId = u.int("signal") ?? (d?.signals.length === 1 ? (d.signals[0]?.id ?? null) : null);
  const notFound = target.error instanceof ApiError && target.error.status === 404;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Targets · Dossier"
        title={d ? d.target.label : valid ? formatKepid(raw) : "Target Dossier"}
        description={
          !valid
            ? `“${raw}” is not a Kepler Input Catalog id (expected up to 9 digits).`
            : d
              ? `${d.signals.length} catalogue signal${d.signals.length === 1 ? "" : "s"} · Kepler magnitude ${formatNumber(d.target.kepmag, { digits: 2 })}`
              : "Stellar parameters, catalogue signals, light curve, datasets and predictions for one Kepler star."
        }
        meta={
          valid ? (
            <>
              <Badge mono>KIC {raw.padStart(9, "0")}</Badge>
              {d ? <LcStatusBadge status={d.target.lc_status} /> : null}
              {d?.reserved_showcase ? (
                <Badge tone="nebula" title="Forced into test splits, never trained on">
                  Reserved showcase
                </Badge>
              ) : null}
            </>
          ) : (
            <Badge tone="warn">Invalid KIC id</Badge>
          )
        }
        actions={
          d ? (
            <>
              <Link to={`/transit?kepid=${d.target.kepid}${signalId ? `&signal=${signalId}` : ""}`} className={buttonClasses({ variant: "secondary" })}>
                <TransitIcon aria-hidden="true" /> Transit analysis
              </Link>
              <Link to={`/detect?kepid=${d.target.kepid}${signalId ? `&signal=${signalId}` : ""}`} className={buttonClasses({ variant: "model" })}>
                <Radar aria-hidden="true" /> Planet detection
              </Link>
            </>
          ) : null
        }
      />
      {!valid || notFound ? (
        <EmptyState
          title={notFound ? "This star is not in the local catalogue" : "Not a valid KIC id"}
          description={notFound ? "Only stars with a DR24 TCE, KOI or confirmed planet are in the catalogue. Search for another star." : "Search by KIC id, Kepler name or KOI instead."}
          actions={<TargetSearchBox className="w-[min(420px,80vw)] text-left" label="Find a star" onSelect={(r) => navigate(`/targets/${r.kepid}${r.matched_signal_id ? `?signal=${r.matched_signal_id}` : ""}`)} />}
        />
      ) : target.isPending ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2" aria-hidden="true">
          <Skeleton height={240} rounded="md" />
          <Skeleton height={240} rounded="md" />
        </div>
      ) : target.isError ? (
        <ApiErrorBanner error={target.error} onRetry={() => void target.refetch()} />
      ) : d ? (
        <Dossier d={d} signalId={signalId} onSignal={(id) => u.set({ signal: id })} />
      ) : null}
    </div>
  );
}
