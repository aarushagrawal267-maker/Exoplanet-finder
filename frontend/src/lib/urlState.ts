/**
 * Page state kept in the URL query string, so filters, selections and analysis inputs survive a
 * reload and can be shared as links (e.g. `/transit?kepid=10666592&signal=19997`).
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export type ParamPatch = Record<string, string | number | boolean | null | undefined>;

export function useUrlState() {
  const [params, setParams] = useSearchParams();

  /** Merge `patch` into the query string; null / undefined / "" remove a key. */
  const set = useCallback(
    (patch: ParamPatch, { replace = true }: { replace?: boolean } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined || v === "" || v === false) next.delete(k);
            else next.set(k, String(v));
          }
          return next;
        },
        { replace },
      );
    },
    [setParams],
  );

  const str = useCallback((k: string): string | null => params.get(k), [params]);
  const int = useCallback(
    (k: string): number | null => {
      const raw = params.get(k);
      if (raw === null || raw.trim() === "") return null;
      const n = Number(raw);
      return Number.isInteger(n) ? n : null;
    },
    [params],
  );
  const num = useCallback(
    (k: string): number | null => {
      const raw = params.get(k);
      if (raw === null || raw.trim() === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    },
    [params],
  );
  const list = useCallback((k: string): string[] => (params.get(k) ?? "").split(",").filter(Boolean), [params]);

  return { params, set, str, int, num, list };
}
