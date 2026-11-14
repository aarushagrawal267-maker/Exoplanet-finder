/**
 * Transit analysis (`/api/analysis/*`): BLS period search, transit fit/vetting and the SYNTHETIC
 * injection–recovery test. These are POSTs but deterministic and cached server-side, so they are
 * modelled as queries keyed by their request body: re-running the same request is instant, and
 * results survive navigating away and back. Pass `null` to keep a query idle until the user asks.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../client";
import type { BlsIn, BlsOut, InjectionIn, InjectionOut, TransitIn, TransitOut } from "../schemas";
import { qk } from "./keys";

export const runBls = (body: BlsIn) => api.post<BlsOut>("/analysis/bls", body);
export const runTransit = (body: TransitIn) => api.post<TransitOut>("/analysis/transit", body);
export const runInjection = (body: InjectionIn) => api.post<InjectionOut>("/analysis/injection", body);

const heavy = { staleTime: Number.POSITIVE_INFINITY, gcTime: 30 * 60_000, retry: false } as const;

export function useBls(body: BlsIn | null) {
  return useQuery({ queryKey: qk.analysis.bls(body ?? {}), queryFn: () => runBls(body as BlsIn), enabled: body !== null, ...heavy });
}

export function useTransitAnalysis(body: TransitIn | null) {
  return useQuery({ queryKey: qk.analysis.transit(body ?? {}), queryFn: () => runTransit(body as TransitIn), enabled: body !== null, ...heavy });
}

export function useInjection(body: InjectionIn | null) {
  return useQuery({ queryKey: qk.analysis.injection(body ?? {}), queryFn: () => runInjection(body as InjectionIn), enabled: body !== null, ...heavy });
}
