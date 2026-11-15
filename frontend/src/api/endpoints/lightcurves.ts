/** Processed light curves for display (`/api/lightcurves/{kepid}`, `/api/uploads/{id}/lightcurve`). */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../client";
import type { LightCurveOut } from "../schemas";
import { qk } from "./keys";

/** Overview plots use 10,000 display points per stage (~0.7 MB); 20,000 doubles the payload. */
export const OVERVIEW_MAX_POINTS = 10_000;

export interface LightCurveParams {
  kepid?: number | null;
  uploadId?: string | null;
  signalId?: number | null;
  period?: number | null;
  epoch?: number | null;
  durationHours?: number | null;
  detrend?: "spline" | "savgol";
  maxPoints?: number;
}

export function fetchLightCurve(p: LightCurveParams, signal?: AbortSignal): Promise<LightCurveOut> {
  const manual =
    p.period && p.epoch !== null && p.epoch !== undefined && p.durationHours
      ? { period: p.period, epoch: p.epoch, duration_hours: p.durationHours }
      : {};
  const common = { detrend: p.detrend, max_points: p.maxPoints ?? OVERVIEW_MAX_POINTS, ...manual };
  if (p.uploadId) return api.get<LightCurveOut>(`/uploads/${p.uploadId}/lightcurve`, common, signal);
  return api.get<LightCurveOut>(`/lightcurves/${p.kepid}`, { ...common, signal_id: manual.period ? undefined : p.signalId }, signal);
}

export function useLightCurve(p: LightCurveParams, options: { enabled?: boolean } = {}) {
  const key = {
    kepid: p.kepid ?? null,
    uploadId: p.uploadId ?? null,
    signalId: p.signalId ?? null,
    period: p.period ?? null,
    epoch: p.epoch ?? null,
    durationHours: p.durationHours ?? null,
    detrend: p.detrend ?? "spline",
    maxPoints: p.maxPoints ?? OVERVIEW_MAX_POINTS,
  };
  return useQuery({
    queryKey: qk.lightcurves.one(key),
    queryFn: ({ signal }) => fetchLightCurve(p, signal),
    enabled: (options.enabled ?? true) && Boolean(p.uploadId || (p.kepid !== null && p.kepid !== undefined)),
    placeholderData: (prev, prevQuery) => {
      // Keep showing the same star while only the ephemeris / stage options change.
      const prevKey = prevQuery?.queryKey[1] as typeof key | undefined;
      return prevKey && prevKey.kepid === key.kepid && prevKey.uploadId === key.uploadId ? keepPreviousData(prev) : undefined;
    },
    staleTime: 10 * 60_000,
  });
}
