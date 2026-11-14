/**
 * Turning a calibrated probability into a displayed verdict.
 *
 * The model outputs a calibrated probability p that the signal is planet-like (class 1). The
 * displayed class is:
 *  - "uncertain"  if p is missing, the data-quality grade is D (a blocking quality issue means the
 *                 model input itself is unreliable), or the uncertainty band p ± σ straddles the
 *                 decision threshold (the model cannot separate the classes for this signal);
 *  - "planet"     if p ≥ threshold;
 *  - "false_positive" otherwise.
 * This is deliberately conservative: it would rather say "uncertain" than overstate.
 */
import type { QualityGrade, SignalClass } from "@/api/types";

export function verdictClass(
  probability: number | null | undefined,
  threshold: number,
  uncertainty?: number | null,
  grade?: QualityGrade | null,
): SignalClass {
  if (probability === null || probability === undefined || !Number.isFinite(probability)) return "uncertain";
  if (grade === "D") return "uncertain";
  if (uncertainty !== null && uncertainty !== undefined && Number.isFinite(uncertainty) && uncertainty > 0) {
    if (Math.abs(probability - threshold) < uncertainty) return "uncertain";
  }
  return probability >= threshold ? "planet" : "false_positive";
}

/** Plain-language meaning of each quality grade (astro/quality.py). */
export const GRADE_INFO: Record<QualityGrade, { title: string; description: string; tone: "good" | "ok" | "warn" | "bad" }> = {
  A: { title: "Grade A", description: "No data-quality issues detected.", tone: "good" },
  B: { title: "Grade B", description: "Minor coverage gaps; the model input is still reliable.", tone: "ok" },
  C: { title: "Grade C", description: "Shape or alignment concerns; treat the verdict with caution.", tone: "warn" },
  D: { title: "Grade D", description: "Blocking issue: the model input is unreliable for this signal.", tone: "bad" },
};
