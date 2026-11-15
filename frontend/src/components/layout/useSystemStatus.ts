/**
 * System status for the sidebar footer. Reads `/api/health` (always available) and
 * `/api/system/summary` for the compute device, the model used for predictions and the latest
 * dataset. Nothing is invented: unknown values render as "—".
 */
import { ApiError } from "@/api/client";
import { useHealth, useSystemSummary } from "@/api/endpoints/system";
import type { DeviceInfo, SystemSummaryOut } from "@/api/schemas";
import type { StatusRow } from "./StatusFooter";

export function deviceText(d: DeviceInfo | null | undefined): string | null {
  if (!d) return null;
  const raw = d.device ?? d.preference;
  if (!raw) return null;
  const name = String(raw).toUpperCase();
  return d.device === "cuda" && d.cuda_device ? `${name} · ${d.cuda_device}` : name;
}

/** The model predictions use by default: the settings default, else the active model. */
export function predictionModel(s: SystemSummaryOut | undefined) {
  return s?.models.default_for_predictions ?? s?.models.active ?? null;
}

export function statusRows(health: ReturnType<typeof useHealth>, summary: ReturnType<typeof useSystemSummary>): StatusRow[] {
  const offline = health.isError;
  const apiRow: StatusRow = health.isSuccess
    ? { key: "api", label: "API", value: `online · v${health.data.version}`, tone: "ok", title: `Pipeline v${health.data.pipeline_version}` }
    : offline
      ? {
          key: "api",
          label: "API",
          value: "offline",
          tone: "error",
          title: health.error instanceof ApiError ? (health.error.hint ?? health.error.detail) : "Backend unreachable",
        }
      : { key: "api", label: "API", value: "checking…", tone: "idle" };

  const s = summary.data;
  const device = deviceText(s?.device);
  const model = predictionModel(s);
  const latestDataset = s?.datasets.latest;

  return [
    apiRow,
    { key: "device", label: "Device", value: device ?? "—", tone: device ? "ok" : "idle", title: s?.device.torch ? `PyTorch ${s.device.torch}` : undefined },
    {
      key: "model",
      label: "Model",
      value: model?.name ?? (s ? "none trained" : "—"),
      tone: model ? (model.is_fixture ? "warn" : "model") : "idle",
      title: model?.is_fixture ? "Fixture model (pipeline test only)" : model ? `${model.model_type} · used for predictions` : undefined,
    },
    {
      key: "dataset",
      label: "Dataset",
      value: latestDataset?.name ?? (s ? "none built" : "—"),
      title: latestDataset ? `Latest dataset: ${latestDataset.status} · ${latestDataset.tier} · ${latestDataset.n_examples} examples` : undefined,
      tone: latestDataset ? (latestDataset.status === "ready" ? "ok" : latestDataset.status === "failed" ? "error" : "warn") : "idle",
    },
  ];
}

export function useSystemStatus(): StatusRow[] {
  const health = useHealth();
  const summary = useSystemSummary({ enabled: health.isSuccess });
  return statusRows(health, summary);
}
