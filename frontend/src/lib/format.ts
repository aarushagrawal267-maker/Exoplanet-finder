/**
 * Number and unit formatters for scientific readouts.
 *
 * Conventions (shared by every page so values read the same everywhere):
 *  - Missing / non-finite values render as an em dash "—" (never "NaN", "null" or "0").
 *  - Negative numbers use the typographic minus sign U+2212 ("−"), which aligns with digits in
 *    JetBrains Mono tabular figures.
 *  - Grouping uses en-US separators ("6,712") so output is deterministic across locales.
 *  - Units follow the value after a normal space ("2.2047 d", "6,712 ppm"), except "%" and "σ".
 *  - Time stamps on Kepler data are BKJD = BJD − 2,454,833.0 (Kepler Barycentric Julian Day).
 */

export const EMPTY = "—";
const MINUS = "−";

export type Num = number | null | undefined;

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export interface NumberFormatOptions {
  /** Fixed number of fraction digits (default 2). */
  digits?: number;
  /** Prefix positive numbers with "+" (useful for deltas). */
  signed?: boolean;
  /** Use thousands separators (default true). */
  group?: boolean;
}

/** Format a plain number with fixed fraction digits, en-US grouping and a true minus sign. */
export function formatNumber(value: Num, { digits = 2, signed = false, group = true }: NumberFormatOptions = {}): string {
  if (!isFiniteNumber(value)) return EMPTY;
  const abs = Math.abs(value);
  const body = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: group,
  }).format(abs);
  // Avoid "−0.00" for values that round to zero.
  const roundsToZero = Number(abs.toFixed(digits)) === 0;
  if (value < 0 && !roundsToZero) return `${MINUS}${body}`;
  if (signed && value > 0 && !roundsToZero) return `+${body}`;
  return body;
}

/** Integer count with grouping: 150000 → "150,000". */
export function formatInt(value: Num): string {
  return formatNumber(isFiniteNumber(value) ? Math.round(value) : value, { digits: 0 });
}

/**
 * Transit depth in parts per million. Depth = fractional flux decrement × 10⁶
 * (e.g. a 0.67 % dip is 6,700 ppm). Values ≥ 10 ppm are shown as integers.
 */
export function formatPpm(value: Num, { digits, unit = true }: { digits?: number; unit?: boolean } = {}): string {
  if (!isFiniteNumber(value)) return EMPTY;
  const d = digits ?? (Math.abs(value) >= 10 ? 0 : 1);
  const s = formatNumber(value, { digits: d });
  return unit ? `${s} ppm` : s;
}

/**
 * A duration or period in days, e.g. an orbital period. Short periods keep 4 decimals
 * (≈ 9 s resolution, enough to compare against catalogue ephemerides); long ones fewer.
 */
export function formatDays(value: Num, { digits, unit = true }: { digits?: number; unit?: boolean } = {}): string {
  if (!isFiniteNumber(value)) return EMPTY;
  const abs = Math.abs(value);
  const d = digits ?? (abs >= 1000 ? 1 : abs >= 100 ? 2 : 4);
  const s = formatNumber(value, { digits: d });
  return unit ? `${s} d` : s;
}

/** A duration in hours, e.g. a transit duration T14. */
export function formatHours(value: Num, { digits = 2, unit = true }: { digits?: number; unit?: boolean } = {}): string {
  if (!isFiniteNumber(value)) return EMPTY;
  const s = formatNumber(value, { digits });
  return unit ? `${s} h` : s;
}

/**
 * A Kepler time stamp (BKJD = BJD_TDB − 2,454,833.0). Four decimals ≈ 8.6 s, finer than the
 * 29.4-minute long-cadence sampling.
 */
export function formatBkjd(value: Num, { digits = 4, unit = true }: { digits?: number; unit?: boolean } = {}): string {
  if (!isFiniteNumber(value)) return EMPTY;
  const s = formatNumber(value, { digits, group: false });
  return unit ? `${s} BKJD` : s;
}

/** A fraction in [0, 1] shown as a percentage: 0.873 → "87.3%". */
export function formatPercent(fraction: Num, { digits = 1, signed = false }: { digits?: number; signed?: boolean } = {}): string {
  if (!isFiniteNumber(fraction)) return EMPTY;
  return `${formatNumber(fraction * 100, { digits, signed })}%`;
}

/**
 * A (calibrated) probability in [0, 1] with fixed precision: 0.8731 → "0.873".
 * Values are clamped to [0, 1]; anything outside that range is a bug upstream, so it is clamped
 * rather than displayed misleadingly.
 */
export function formatProbability(p: Num, { digits = 3 }: { digits?: number } = {}): string {
  if (!isFiniteNumber(p)) return EMPTY;
  const clamped = Math.min(1, Math.max(0, p));
  return formatNumber(clamped, { digits, group: false });
}

/** A significance in standard deviations: 3.24 → "3.2σ". */
export function formatSigma(value: Num, { digits = 1 }: { digits?: number } = {}): string {
  if (!isFiniteNumber(value)) return EMPTY;
  return `${formatNumber(value, { digits })}σ`;
}

/** "value ± err" with a shared precision: (6712.3, 45.1) → "6,712 ± 45". */
export function formatWithError(value: Num, err: Num, { digits = 0, unit }: { digits?: number; unit?: string } = {}): string {
  if (!isFiniteNumber(value)) return EMPTY;
  const v = formatNumber(value, { digits });
  const e = isFiniteNumber(err) ? ` ± ${formatNumber(Math.abs(err), { digits })}` : "";
  return unit ? `${v}${e} ${unit}` : `${v}${e}`;
}

/**
 * An elapsed / remaining time in seconds: 42 → "42 s", 185 → "3 min 05 s",
 * 3720 → "1 h 02 min", 183600 → "2 d 3 h".
 */
export function formatDuration(seconds: Num): string {
  if (!isFiniteNumber(seconds) || seconds < 0) return EMPTY;
  if (seconds < 1) return "<1 s";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m} min ${String(rs).padStart(2, "0")} s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `${h} h ${String(rm).padStart(2, "0")} min`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d} d ${rh} h`;
}

/** Remaining-time text for progress indicators: 185 → "about 3 min 05 s left". */
export function formatEta(seconds: Num): string {
  if (!isFiniteNumber(seconds) || seconds < 0) return EMPTY;
  if (seconds < 1) return "almost done";
  return `about ${formatDuration(seconds)} left`;
}

/** File / disk sizes using decimal SI units (1 kB = 1000 B): 1536 → "1.5 kB". */
export function formatBytes(bytes: Num, { digits = 1 }: { digits?: number } = {}): string {
  if (!isFiniteNumber(bytes) || bytes < 0) return EMPTY;
  const units = ["B", "kB", "MB", "GB", "TB"] as const;
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  return i === 0 ? `${Math.round(v)} B` : `${formatNumber(v, { digits })} ${units[i]}`;
}

/** Kepler Input Catalog identifier: 10666592 → "KIC 10666592". */
export function formatKepid(kepid: Num | string): string {
  if (kepid === null || kepid === undefined || kepid === "") return EMPTY;
  const n = typeof kepid === "string" ? Number.parseInt(kepid, 10) : kepid;
  if (!isFiniteNumber(n)) return EMPTY;
  return `KIC ${Math.trunc(n)}`;
}

/** ISO date-time → "2026-11-14 19:42 UTC" (always UTC, so logs and reports agree). */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** Relative time: "just now", "5 min ago", "3 h ago", "2 d ago" (falls back to the date). */
export function formatRelativeTime(value: string | number | Date | null | undefined, now: Date = new Date()): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 0) return formatDateTime(d);
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 30 * 86400) return `${Math.round(diff / 86400)} d ago`;
  return formatDateTime(d);
}
