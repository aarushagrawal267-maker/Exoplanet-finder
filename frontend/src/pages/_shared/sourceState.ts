/**
 * The analysed light-curve source shared by Transit Analysis and Planet Detection, kept in the URL:
 * `?src=catalog&kepid=…&signal=…` or `?src=upload&upload=…`, plus the ephemeris choice
 * (`eph=catalog|bls|manual`, manual values `p`, `t0`, `dur`).
 */
import { useMemo } from "react";
import type { AnalysisSource } from "@/api/schemas";
import type { EphemerisMode, ManualEphemeris } from "@/components/science/EphemerisChooser";
import { useUrlState } from "@/lib/urlState";

export type SourceKind = "catalog" | "upload";

export function useSourceState() {
  const u = useUrlState();
  const kind: SourceKind = u.str("src") === "upload" || (!u.str("src") && u.str("upload")) ? "upload" : "catalog";
  const kepid = u.int("kepid");
  const signalId = u.int("signal");
  const uploadId = u.str("upload");
  const ephParam = u.str("eph");
  const manual: ManualEphemeris = { period: u.num("p"), epoch: u.num("t0"), durationHours: u.num("dur") };
  const defaultEph: EphemerisMode = kind === "catalog" && signalId !== null ? "catalog" : "bls";
  let eph: EphemerisMode = ephParam === "catalog" || ephParam === "bls" || ephParam === "manual" ? ephParam : defaultEph;
  if (eph === "catalog" && (kind !== "catalog" || signalId === null)) eph = "bls";

  const source: AnalysisSource | null = useMemo(() => {
    if (kind === "catalog") return kepid !== null ? { type: "catalog", kepid } : null;
    return uploadId ? { type: "upload", upload_id: uploadId } : null;
  }, [kind, kepid, uploadId]);

  return {
    u,
    kind,
    kepid,
    signalId,
    uploadId,
    eph,
    manual,
    source,
    setKind: (k: SourceKind) => u.set({ src: k === "upload" ? "upload" : null }),
    setStar: (k: number | null, s: number | null) => u.set({ kepid: k, signal: s, eph: null }, { replace: false }),
    setUpload: (id: string | null) => u.set({ upload: id, src: "upload", eph: null }, { replace: false }),
    setEph: (m: EphemerisMode) => u.set({ eph: m }),
    setManual: (m: ManualEphemeris) => u.set({ p: m.period, t0: m.epoch, dur: m.durationHours }),
  };
}
