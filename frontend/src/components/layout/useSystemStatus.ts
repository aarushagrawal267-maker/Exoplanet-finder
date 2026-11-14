/**
 * System status for the sidebar footer. Reads `/api/health` (always available) and, when the
 * backend provides it, `/api/system/summary` for device / active model / latest dataset. Nothing
 * is invented: unknown values render as "—".
 */
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type { HealthOut } from "@/api/types";
import type { StatusRow } from "./StatusFooter";

interface SummaryLike {
  device?: { name?: string; type?: string; device?: string } | string | null;
  models?: { active?: { name?: string; model_type?: string; is_fixture?: boolean } | null; count?: number } | null;
  datasets?: { latest?: { name?: string } | null; count?: number } | null;
}

function deviceText(d: SummaryLike["device"]): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.toUpperCase();
  const raw = d.type ?? d.device ?? d.name;
  return raw ? String(raw).toUpperCase() : null;
}

export function useSystemStatus(): StatusRow[] {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => api.get<HealthOut>("/health", undefined, signal),
    refetchInterval: 30_000,
    retry: false,
  });
  const summary = useQuery({
    queryKey: ["system", "summary"],
    queryFn: ({ signal }) => api.get<SummaryLike>("/system/summary", undefined, signal),
    enabled: health.isSuccess,
    refetchInterval: 60_000,
    retry: false,
  });

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
  const activeModel = s?.models?.active;
  const latestDataset = s?.datasets?.latest;

  return [
    apiRow,
    { key: "device", label: "Device", value: device ?? "—", tone: device ? "ok" : "idle" },
    {
      key: "model",
      label: "Model",
      value: activeModel?.name ?? (s?.models ? "none trained" : "—"),
      tone: activeModel ? (activeModel.is_fixture ? "warn" : "model") : "idle",
      title: activeModel?.is_fixture ? "Fixture model (pipeline test only)" : undefined,
    },
    {
      key: "dataset",
      label: "Dataset",
      value: latestDataset?.name ?? (s?.datasets ? "none built" : "—"),
      tone: latestDataset ? "ok" : "idle",
    },
  ];
}
