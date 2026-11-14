/**
 * Settings — preferences stored by the backend (validated all-or-nothing), storage usage per
 * category with confirmed clear actions, a consistent database backup download, and diagnostics
 * (versions, paths, device, and an optional network check against NASA services).
 */
import { CheckCircle2, CircleSlash2, Download, HardDrive, RotateCcw, Save, Trash2, Wifi } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useModels } from "@/api/endpoints/models";
import { BACKUP_URL, useClearStorage, useSettings, useStorage, useUpdateSettings } from "@/api/endpoints/settings";
import { useDiagnostics } from "@/api/endpoints/system";
import type { ClearIn, SettingDescription, StorageCategory } from "@/api/schemas";
import { deviceText } from "@/components/layout/useSystemStatus";
import { ApiErrorBanner, errorParts } from "@/components/ui/ApiErrorBanner";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Modal } from "@/components/ui/Modal";
import { NumberInput } from "@/components/ui/NumberInput";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/cn";
import { formatBytes, formatInt, formatNumber, formatPercent } from "@/lib/format";

const LABELS: Record<string, string> = {
  device: "Compute device",
  download_workers: "Parallel downloads",
  keep_raw_fits: "Keep raw FITS files",
  default_model_id: "Default model for predictions",
  default_threshold_mode: "Decision threshold",
  ui_density: "Table density",
  reduced_motion: "Animations",
};
const CHOICE_TEXT: Record<string, string> = {
  auto: "Automatic (GPU when available)",
  cpu: "CPU",
  cuda: "NVIDIA GPU (CUDA)",
  mps: "Apple GPU (MPS)",
  validation_f1: "F1-optimal on validation",
  "fixed_0.5": "Fixed at 0.5",
  comfortable: "Comfortable",
  compact: "Compact",
  system: "Follow the operating system",
  on: "Always reduce",
  off: "Never reduce",
};
const ORDER = ["device", "default_model_id", "default_threshold_mode", "download_workers", "keep_raw_fits", "ui_density", "reduced_motion"];

type Values = Record<string, unknown>;

/** Client-side check mirroring the server's rules (the server stays authoritative). */
export function validateSetting(desc: SettingDescription, value: unknown): string | null {
  if (desc.kind === "int") {
    if (typeof value !== "number" || !Number.isInteger(value)) return "Enter a whole number.";
    if (desc.minimum !== null && desc.minimum !== undefined && value < desc.minimum) return `Must be at least ${desc.minimum}.`;
    if (desc.maximum !== null && desc.maximum !== undefined && value > desc.maximum) return `Must be at most ${desc.maximum}.`;
  }
  if (desc.kind === "choice" && desc.choices && !desc.choices.includes(value)) return "Choose one of the options.";
  return null;
}

function PreferencesForm() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const models = useModels(true);
  const [draft, setDraft] = useState<Values>({});
  const [saved, setSaved] = useState(false);
  const values = settings.data?.values;
  useEffect(() => {
    if (values) setDraft(values);
  }, [values]);

  const s = settings.data;
  const keys = useMemo(() => (s ? [...ORDER.filter((k) => k in s.descriptions), ...Object.keys(s.descriptions).filter((k) => !ORDER.includes(k))] : []), [s]);
  if (settings.isPending) return <Skeleton height={320} rounded="md" />;
  if (settings.isError) return <ApiErrorBanner error={settings.error} onRetry={() => void settings.refetch()} />;
  const data = s as NonNullable<typeof s>;

  const errors: Record<string, string> = {};
  for (const k of keys) {
    const d = data.descriptions[k];
    const e = d ? validateSetting(d, draft[k]) : null;
    if (e) errors[k] = e;
  }
  // The server names the offending setting in its message; attach it to that field.
  const serverError = update.error ? errorParts(update.error) : null;
  const serverKey = serverError ? keys.find((k) => serverError.detail.includes(k)) : undefined;
  const changed = Object.fromEntries(keys.filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(data.values[k])).map((k) => [k, draft[k]]));
  const dirty = Object.keys(changed).length > 0;
  const atDefaults = keys.every((k) => JSON.stringify(draft[k]) === JSON.stringify(data.defaults[k]));

  const control = (k: string) => {
    const d = data.descriptions[k] as SettingDescription;
    const v = draft[k];
    const set = (nv: unknown) => {
      setSaved(false);
      setDraft((prev) => ({ ...prev, [k]: nv }));
    };
    if (d.kind === "bool") return <Switch checked={Boolean(v)} onChange={set} aria-label={LABELS[k] ?? k} />;
    if (d.kind === "int")
      return <NumberInput value={typeof v === "number" ? v : null} onChange={set} min={undefined} max={undefined} step={1} precision={0} allowEmpty className="w-40" />;
    if (d.kind === "optional_int" && k === "default_model_id") {
      return (
        <Select
          value={v === null || v === undefined ? "" : String(v)}
          onChange={(nv) => set(nv === "" ? null : Number(nv))}
          options={[
            { value: "", label: "The active model (automatic)" },
            ...(models.data ?? []).map((m) => ({ value: String(m.id), label: `${m.name}${m.is_fixture ? " (fixture)" : ""}${m.is_active ? " · active" : ""}` })),
            ...(typeof v === "number" && !(models.data ?? []).some((m) => m.id === v) ? [{ value: String(v), label: `Model #${v} (not found)` }] : []),
          ]}
        />
      );
    }
    if (d.kind === "optional_int") return <NumberInput value={typeof v === "number" ? v : null} onChange={set} step={1} precision={0} allowEmpty className="w-40" />;
    return <Select value={String(v ?? "")} onChange={set} options={(d.choices ?? []).map((c) => ({ value: String(c), label: CHOICE_TEXT[String(c)] ?? String(c) }))} />;
  };

  const fmtDefault = (k: string) => {
    const v = data.defaults[k];
    if (v === null || v === undefined) return "automatic";
    if (typeof v === "boolean") return v ? "on" : "off";
    return CHOICE_TEXT[String(v)] ?? String(v);
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (Object.keys(errors).length || !dirty) return;
        update.mutate(changed, { onSuccess: () => setSaved(true) });
      }}
      noValidate
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
        {keys.map((k) => {
          const d = data.descriptions[k] as SettingDescription;
          const range = d.kind === "int" && (d.minimum !== null || d.maximum !== null) ? ` Allowed: ${d.minimum ?? "…"}–${d.maximum ?? "…"}.` : "";
          return (
            <Field
              key={k}
              label={LABELS[k] ?? k}
              help={`${d.description}${range} Default: ${fmtDefault(k)}.`}
              error={errors[k] ?? (serverKey === k ? serverError?.detail : undefined)}
            >
              {control(k)}
            </Field>
          );
        })}
      </div>
      {update.isError && !serverKey ? <ApiErrorBanner error={update.error} title="Settings were not saved" /> : null}
      {update.isError && serverKey ? (
        <Banner tone="danger" title="Settings were not saved">
          Nothing was changed: one value is invalid (see {LABELS[serverKey] ?? serverKey}).
        </Banner>
      ) : null}
      {saved && !dirty ? (
        <p className="flex items-center gap-2 text-sm text-fg" role="status">
          <CheckCircle2 className="size-4 text-signal-planet" aria-hidden="true" /> Saved.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
        <Button type="submit" variant="primary" icon={<Save />} loading={update.isPending} disabled={!dirty || Object.keys(errors).length > 0}>
          Save changes
        </Button>
        <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(data.values)}>
          Discard
        </Button>
        <Button variant="ghost" icon={<RotateCcw />} disabled={atDefaults} onClick={() => setDraft(data.defaults)}>
          Reset to defaults
        </Button>
        {dirty ? <span className="text-xs text-warn">{Object.keys(changed).length} unsaved change{Object.keys(changed).length === 1 ? "" : "s"}</span> : null}
      </div>
    </form>
  );
}

const CLEAR_TEXT: Record<ClearIn["target"], string> = {
  raw_fits: "Deletes the original MAST quarter files. The stitched light-curve cache is kept, so nothing needs re-downloading for analysis.",
  uploads: "Deletes every uploaded light curve and its parsed data. Predictions already made keep their stored results.",
  views_cache: "Deletes cached per-signal model views. They are recomputed on demand (slower the first time).",
};

function StoragePanel() {
  const storage = useStorage();
  const clear = useClearStorage();
  const [confirm, setConfirm] = useState<StorageCategory | null>(null);
  const [result, setResult] = useState<string | null>(null);
  if (storage.isPending) return <Skeleton height={300} rounded="md" />;
  if (storage.isError) return <ApiErrorBanner error={storage.error} onRetry={() => void storage.refetch()} />;
  const st = storage.data;
  const max = Math.max(1, ...st.categories.map((c) => c.bytes));
  const disk = st.disk;
  return (
    <div className="flex flex-col gap-5">
      {disk ? (
        <div>
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="text-fg">
              Disk <span className="num text-xs text-fg-secondary">{disk.path}</span>
            </span>
            <span className="num text-fg-secondary">
              {formatBytes(disk.free)} free of {formatBytes(disk.total)}
            </span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-hairline" role="img" aria-label={`Disk ${formatPercent(disk.used / disk.total, { digits: 0 })} used; Exoplanet Finder uses ${formatBytes(st.total_bytes)}`}>
            <span className="absolute inset-y-0 left-0 bg-fg-secondary/50" style={{ width: `${(disk.used / disk.total) * 100}%` }} />
            <span className="absolute inset-y-0 left-0 bg-cosmic" style={{ width: `${(st.total_bytes / disk.total) * 100}%` }} />
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-fg-secondary">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-cosmic" aria-hidden="true" /> Exoplanet Finder <span className="num">{formatBytes(st.total_bytes)}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-fg-secondary/50" aria-hidden="true" /> Used in total <span className="num">{formatBytes(disk.used)}</span>
            </span>
          </p>
        </div>
      ) : null}
      {result ? (
        <Banner tone="info" title="Storage cleared" onDismiss={() => setResult(null)}>
          {result}
        </Banner>
      ) : null}
      <ul className="divide-y divide-hairline rounded-lg border border-hairline">
        {st.categories.map((c) => (
          <li key={c.key} className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_180px_88px] sm:items-center sm:gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">{c.label}</p>
              <p className="text-xs text-fg-secondary">{c.description}</p>
              <p className="num mt-0.5 truncate text-2xs text-fg-secondary" title={c.path}>
                {c.path}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="num text-sm text-fg">
                {formatBytes(c.bytes)} <span className="text-xs text-fg-secondary">· {formatInt(c.n_files)} files</span>
              </span>
              <span className="h-1 rounded-full bg-hairline" aria-hidden="true">
                <span className="block h-full rounded-full bg-cosmic/70" style={{ width: `${(c.bytes / max) * 100}%` }} />
              </span>
            </div>
            <div className="sm:justify-self-end">
              {c.clearable ? (
                <Button size="sm" variant="danger" icon={<Trash2 />} disabled={c.n_files === 0} onClick={() => setConfirm(c)} aria-label={`Clear ${c.label}`}>
                  Clear
                </Button>
              ) : (
                <span className="text-xs text-fg-secondary">kept</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Modal
        open={confirm !== null}
        onClose={() => {
          setConfirm(null);
          clear.reset();
        }}
        title={confirm ? `Clear ${confirm.label.toLowerCase()}?` : ""}
        description={confirm ? `${formatInt(confirm.n_files)} files, ${formatBytes(confirm.bytes)}. This cannot be undone.` : undefined}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirm(null);
                clear.reset();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 />}
              loading={clear.isPending}
              onClick={() => {
                if (!confirm) return;
                const label = confirm.label;
                clear.mutate(confirm.key as ClearIn["target"], {
                  onSuccess: (out) => {
                    setConfirm(null);
                    setResult(`${label}: removed ${formatInt(out.files_removed)} files, freed ${formatBytes(out.bytes_freed)}.`);
                  },
                });
              }}
            >
              Delete files
            </Button>
          </>
        }
      >
        {confirm ? <p className="text-sm text-fg-secondary">{CLEAR_TEXT[confirm.key as ClearIn["target"]] ?? confirm.description}</p> : null}
        {clear.isError ? <ApiErrorBanner className="mt-3" error={clear.error} title={errorParts(clear.error).code === "job_running" ? "A running job is using these files" : undefined} /> : null}
      </Modal>
    </div>
  );
}

function DiagnosticsPanel() {
  const diag = useDiagnostics(false);
  const [checkNet, setCheckNet] = useState(false);
  const net = useDiagnostics(true, { enabled: checkNet });
  if (diag.isPending) return <Skeleton height={260} rounded="md" />;
  if (diag.isError) return <ApiErrorBanner error={diag.error} onRetry={() => void diag.refetch()} />;
  const d = diag.data;
  const checks = net.data?.network ?? null;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="eyebrow mb-2 text-fg-secondary">Compute device</div>
          <KeyValueList
            dense
            items={[
              { key: "dev", label: "In use", value: deviceText(d.device) ?? "—" },
              { key: "pref", label: "Preference", value: d.device.preference ?? "—" },
              { key: "cuda", label: "CUDA GPU", value: d.device.cuda_available ? (d.device.cuda_device ?? "available") : "not available", mono: false },
              { key: "mps", label: "Apple MPS", value: d.device.mps_available ? "available" : "not available", mono: false },
              { key: "torch", label: "PyTorch", value: d.device.torch ?? "—" },
              { key: "cpu", label: "CPU threads", value: `${formatInt(d.device.torch_num_threads)} of ${formatInt(d.device.cpu_count)}` },
            ]}
          />
          {d.device.error ? <p className="mt-2 text-xs text-danger">{d.device.error}</p> : null}
        </div>
        <div>
          <div className="eyebrow mb-2 text-fg-secondary">Versions</div>
          <KeyValueList dense items={Object.entries(d.versions).map(([k, v]) => ({ key: k, label: k, value: v ?? "not installed" }))} />
        </div>
      </div>
      <div>
        <div className="eyebrow mb-2 text-fg-secondary">Data folders</div>
        <ul className="divide-y divide-hairline rounded-lg border border-hairline">
          {Object.entries(d.paths).map(([k, p]) => (
            <li key={k} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span className="min-w-0">
                <span className="block text-sm text-fg">{k.replace(/_/g, " ")}</span>
                <span className="num block truncate text-2xs text-fg-secondary" title={p.path}>
                  {p.path}
                </span>
              </span>
              <span className="flex gap-1.5">
                <Badge tone={p.exists ? "cosmic" : "danger"}>{p.exists ? "exists" : "missing"}</Badge>
                <Badge tone={p.writable ? "cosmic" : "warn"}>{p.writable ? "writable" : "read-only"}</Badge>
              </span>
            </li>
          ))}
        </ul>
        <p className="num mt-2 break-all text-xs text-fg-secondary">database: {d.database_url}</p>
      </div>
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <span className="eyebrow text-fg-secondary">Network</span>
          <Button size="sm" variant="secondary" icon={<Wifi />} loading={net.isFetching} onClick={() => (checkNet ? void net.refetch() : setCheckNet(true))}>
            {checks ? "Check again" : "Check connection to NASA"}
          </Button>
        </div>
        {net.isError ? <ApiErrorBanner error={net.error} /> : null}
        {checks ? (
          <ul className="divide-y divide-hairline rounded-lg border border-hairline">
            {checks.map((c) => (
              <li key={c.name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="min-w-0">
                  <span className="block text-sm text-fg">{c.name}</span>
                  <span className="num block truncate text-2xs text-fg-secondary">{c.url}</span>
                  {c.error ? <span className="block text-xs text-danger">{c.error}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className="num text-xs text-fg-secondary">
                    {c.status_code ? `HTTP ${c.status_code} · ` : ""}
                    {formatNumber(c.elapsed_ms, { digits: 0 })} ms
                  </span>
                  {c.ok ? (
                    <Badge tone="cosmic" icon={<CheckCircle2 aria-hidden="true" />}>
                      reachable
                    </Badge>
                  ) : (
                    <Badge tone="danger" icon={<CircleSlash2 aria-hidden="true" />}>
                      unreachable
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-secondary">Not checked. The check contacts the NASA Exoplanet Archive and MAST (a few seconds).</p>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Reference · 02" title="Settings" description="Preferences, local storage, database backup and diagnostics. Everything stays on this machine." />
      <Card>
        <CardHeader eyebrow="Preferences" title="How the app works" description="Saved on the server; a change is applied all-or-nothing — if one value is invalid, nothing is saved." />
        <PreferencesForm />
      </Card>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader eyebrow="Storage" title="Disk usage by category" actions={<HardDrive className="size-4 text-fg-secondary" aria-hidden="true" />} />
          <StoragePanel />
        </Card>
        <Card className="self-start">
          <CardHeader eyebrow="Backup" title="Database backup" description="A consistent copy of the SQLite database: catalogue provenance, datasets, experiments, models' metadata and predictions. Light curves and checkpoints are files on disk and are not included." />
          <a href={BACKUP_URL} download className={cn(buttonClasses({ variant: "secondary" }))}>
            <Download aria-hidden="true" /> Download backup (.db)
          </a>
        </Card>
      </div>
      <Card>
        <CardHeader eyebrow="Diagnostics" title="System information" description="Useful when reporting a problem." />
        <DiagnosticsPanel />
      </Card>
    </div>
  );
}
