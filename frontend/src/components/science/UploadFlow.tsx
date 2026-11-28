/**
 * Upload a light curve: choose a file → (CSV) confirm the column mapping → choose the time system →
 * parse. The server suggests a mapping and time system; FITS headers that declare their time system
 * override the choice (the parse result then carries a warning). The upload id lives in the page URL.
 */
import { CheckCircle2, FileUp, RotateCcw, Upload } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useParseUpload, useUpload, useUploadFile } from "@/api/endpoints/uploads";
import type { ColumnMapping, TimeSystemIn, UploadOut } from "@/api/schemas";
import { ApiErrorBanner } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stepper, type Step } from "@/components/ui/Stepper";
import { cn } from "@/lib/cn";
import { formatBkjd, formatBytes, formatDays, formatInt, formatNumber } from "@/lib/format";

export const TIME_SYSTEMS: ReadonlyArray<{ value: TimeSystemIn; label: string; help: string }> = [
  { value: "BKJD", label: "BKJD — Kepler (BJD − 2,454,833)", help: "Kepler mission time; catalogue ephemerides use it." },
  { value: "BJD", label: "BJD — full Barycentric Julian Date", help: "Converted to BKJD on parse." },
  { value: "BTJD", label: "BTJD — TESS (BJD − 2,457,000)", help: "TESS mission time; kept as BTJD." },
  { value: "other", label: "Other — relative days", help: "Times in days from an arbitrary zero; ephemerides must use the same zero." },
];

const ACCEPT = ".fits,.fit,.fits.gz,.fz,.csv,.txt,.tsv,.dat";
const NONE = "__none__";

function MappingForm({ upload, onParsed }: { upload: UploadOut; onParsed: () => void }) {
  const parse = useParseUpload();
  const isCsv = upload.kind === "csv";
  const cols = upload.columns ?? [];
  // Re-parsing starts from the previous choice, else from the server's suggestion.
  const sugg = upload.parsed?.mapping ?? upload.suggested_mapping ?? {};
  const fitsFlux = String(upload.parsed?.mapping?.flux ?? (upload.meta as Record<string, unknown> | undefined)?.flux_column ?? "PDCSAP_FLUX");
  const [mapping, setMapping] = useState<ColumnMapping>(() =>
    isCsv ? { time: sugg.time ?? null, flux: sugg.flux ?? null, flux_err: sugg.flux_err ?? null, quality: sugg.quality ?? null } : { flux: fitsFlux },
  );
  const [timeSystem, setTimeSystem] = useState<TimeSystemIn>(() => {
    const s = upload.parsed?.input_time_system ?? upload.suggested_time_system;
    return s === "BKJD" || s === "BJD" || s === "BTJD" ? s : "other";
  });
  const missing = isCsv && (!mapping.time || !mapping.flux);
  const sameCol = isCsv && mapping.time && mapping.time === mapping.flux;
  const options = (optional: boolean) => [
    ...(optional ? [{ value: NONE, label: "— none —" }] : []),
    ...cols.map((c) => ({ value: c, label: c })),
  ];
  const set = (k: keyof ColumnMapping) => (v: string) => setMapping((m) => ({ ...m, [k]: v === NONE ? null : v }));

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (missing || sameCol) return;
        parse.mutate({ uploadId: upload.upload_id, body: { mapping, time_system: timeSystem } }, { onSuccess: onParsed });
      }}
    >
      {isCsv ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Time column" required error={!mapping.time ? "Choose the column holding the time stamps." : sameCol ? "Time and flux must be different columns." : undefined}>
              <Select mono value={mapping.time ?? ""} placeholder="Choose a column…" onChange={set("time")} options={options(false)} />
            </Field>
            <Field label="Flux column" required error={!mapping.flux ? "Choose the column holding the flux." : undefined}>
              <Select mono value={mapping.flux ?? ""} placeholder="Choose a column…" onChange={set("flux")} options={options(false)} />
            </Field>
            <Field label="Flux uncertainty" help="Optional; improves the transit fit weights.">
              <Select mono value={mapping.flux_err ?? NONE} onChange={set("flux_err")} options={options(true)} />
            </Field>
            <Field label="Quality flags" help="Optional; non-zero rows are dropped.">
              <Select mono value={mapping.quality ?? NONE} onChange={set("quality")} options={options(true)} />
            </Field>
          </div>
          {upload.preview_rows.length ? (
            <div className="relative overflow-x-auto rounded-md border border-hairline">
              <table className="w-full text-xs" aria-label="First rows of the uploaded table">
                <thead className="bg-space">
                  <tr>
                    {cols.map((c) => (
                      <th key={c} scope="col" className={cn("eyebrow whitespace-nowrap px-3 py-2 text-right font-medium", Object.values(mapping).includes(c) ? "text-cosmic" : "text-fg-secondary")}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {upload.preview_rows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t border-hairline">
                      {cols.map((c) => (
                        <td key={c} className="num whitespace-nowrap px-3 py-1.5 text-right text-fg">
                          {typeof row[c] === "number" ? formatNumber(row[c] as number, { digits: 6, group: false }) : String(row[c] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <KeyValueList
            dense
            items={[
              { key: "mission", label: "Mission", value: String(upload.meta?.mission ?? "—"), mono: false },
              { key: "object", label: "Object", value: String(upload.meta?.object ?? "—") },
              { key: "quarter", label: "Quarter", value: upload.meta?.quarter !== undefined ? String(upload.meta.quarter) : "—" },
              { key: "cadence", label: "Cadence", value: typeof upload.meta?.cadence_days === "number" ? formatDays(upload.meta.cadence_days as number, { digits: 5 }) : "—" },
              { key: "rows", label: "Rows", value: formatInt(upload.n_rows) },
            ]}
          />
          <Field label="Flux column" help="PDCSAP is the systematics-corrected flux the models were trained on; SAP is simple aperture photometry.">
            <Select
              mono
              value={mapping.flux ?? "PDCSAP_FLUX"}
              onChange={(v) => setMapping({ flux: v })}
              options={[
                { value: "PDCSAP_FLUX", label: "PDCSAP_FLUX" },
                { value: "SAP_FLUX", label: "SAP_FLUX" },
              ]}
            />
          </Field>
        </div>
      )}

      <Field
        label="Time system"
        help={
          upload.kind === "fits"
            ? "A time system declared in the FITS header takes precedence; the parse result says so if it overrode this choice."
            : TIME_SYSTEMS.find((t) => t.value === timeSystem)?.help
        }
        aside={upload.suggested_time_system ? <span className="num">suggested: {upload.suggested_time_system}</span> : undefined}
      >
        <Select value={timeSystem} onChange={(v) => setTimeSystem(v as TimeSystemIn)} options={TIME_SYSTEMS.map((t) => ({ value: t.value, label: t.label }))} />
      </Field>

      {parse.isError ? <ApiErrorBanner error={parse.error} /> : null}
      <div>
        <Button type="submit" variant="primary" loading={parse.isPending} disabled={Boolean(missing || sameCol)}>
          Parse light curve
        </Button>
      </div>
    </form>
  );
}

function ParsedSummary({ upload, onEdit, onReset }: { upload: UploadOut; onEdit: () => void; onReset: () => void }) {
  const p = upload.parsed;
  if (!p) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-fg">
          <CheckCircle2 className="size-4 text-signal-planet" aria-hidden="true" />
          Parsed <span className="num">{formatInt(p.n_points)}</span> points from <span className="num">{upload.filename}</span>
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={onEdit}>
            Change parsing
          </Button>
          <Button size="sm" variant="secondary" icon={<FileUp />} onClick={onReset}>
            Use another file
          </Button>
        </div>
      </div>
      <KeyValueList
        columns={2}
        dense
        items={[
          { key: "span", label: "Time span", value: formatDays(p.time_span_days, { digits: 2 }) },
          { key: "range", label: "Range", value: `${formatBkjd(p.time_start, { digits: 2, unit: false })} – ${formatBkjd(p.time_end, { digits: 2, unit: false })}` },
          { key: "cad", label: "Cadence", value: p.cadence_days ? `${formatNumber(p.cadence_days * 24 * 60, { digits: 1 })} min` : "—" },
          { key: "ts", label: "Time system", value: `${p.time_system ?? "—"}${p.input_time_system && p.input_time_system !== p.time_system ? ` (from ${p.input_time_system})` : ""}` },
          { key: "mission", label: "Mission", value: p.mission ?? "—", mono: false },
          { key: "kic", label: "Kepler id", value: p.kepid ? `KIC ${p.kepid}` : "—" },
        ]}
      />
      {p.out_of_distribution ? (
        <Banner tone="warn" title="Out of distribution for the models">
          The models were trained only on Kepler long-cadence PDCSAP light curves processed by this pipeline. Scores on this data are unreliable.
        </Banner>
      ) : null}
      {p.warnings.length ? (
        <ul className="flex flex-col gap-1.5 text-sm text-fg-secondary" aria-label="Parse warnings">
          {p.warnings.map((w) => (
            <li key={w} className="flex gap-2">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-warn" aria-hidden="true" />
              {w}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export interface UploadFlowProps {
  uploadId: string | null;
  onChange: (uploadId: string | null) => void;
  /** Called with the upload once it has been parsed (and again after re-parsing). */
  onReady?: (upload: UploadOut) => void;
  className?: string;
}

export function UploadFlow({ uploadId, onChange, onReady, className }: UploadFlowProps) {
  const upload = useUpload(uploadId);
  const send = useUploadFile();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const up = upload.data;
  const parsed = Boolean(up?.parsed) && !editing;

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    if (up?.parsed && !editing) onReadyRef.current?.(up);
  }, [up, editing]);

  const pick = (file: File | undefined) => {
    if (!file) return;
    send.mutate(file, {
      onSuccess: (res) => {
        setEditing(false);
        onChange(res.upload_id);
      },
    });
  };

  const steps: Step[] = [
    { id: "file", label: "File", status: up ? "complete" : "current", description: up ? up.filename : "FITS or CSV" },
    { id: "map", label: up?.kind === "fits" ? "Flux & time" : "Columns & time", status: parsed ? "complete" : up ? "current" : "upcoming" },
    { id: "parse", label: "Parsed", status: parsed ? "complete" : "upcoming" },
  ];

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <Stepper steps={steps} aria-label="Upload steps" />
      {uploadId && upload.isPending ? (
        <Skeleton height={120} rounded="md" />
      ) : uploadId && upload.isError ? (
        <ApiErrorBanner error={upload.error} action={<Button size="sm" onClick={() => onChange(null)}>Start over</Button>} />
      ) : !up ? (
        <div
          onDragOver={(e: DragEvent) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files[0]);
          }}
          className={cn(
            "flex flex-col items-center gap-3 rounded-card border border-dashed px-6 py-8 text-center transition-colors",
            dragging ? "border-cosmic bg-cosmic/[0.06]" : "border-hairline-strong",
          )}
        >
          <Upload className="size-6 text-fg-secondary" aria-hidden="true" />
          <div>
            <p className="text-sm text-fg">Drop a light-curve file here, or choose one</p>
            <p className="mt-1 text-xs text-fg-secondary">Kepler/TESS FITS (.fits, .fits.gz) or a CSV / text table with time and flux columns · up to 200 MB</p>
          </div>
          <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" aria-label="Light-curve file" onChange={(e) => pick(e.target.files?.[0])} />
          <Button variant="primary" icon={<FileUp />} loading={send.isPending} onClick={() => fileRef.current?.click()}>
            Choose file
          </Button>
          {send.isError ? <ApiErrorBanner className="w-full text-left" error={send.error} /> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="neutral" mono>
              {up.kind.toUpperCase()}
            </Badge>
            <span className="num min-w-0 truncate text-fg">{up.filename}</span>
            <span className="num text-xs text-fg-secondary">
              {formatBytes(up.size_bytes)} · {formatInt(up.n_rows)} rows
            </span>
          </div>
          {parsed ? (
            <ParsedSummary upload={up} onEdit={() => setEditing(true)} onReset={() => onChange(null)} />
          ) : (
            <>
              <MappingForm key={up.upload_id} upload={up} onParsed={() => setEditing(false)} />
              <div>
                <Button size="sm" variant="ghost" icon={<FileUp />} onClick={() => onChange(null)}>
                  Use another file
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
