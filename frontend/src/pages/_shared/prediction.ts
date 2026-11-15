/** Shared helpers for showing stored predictions consistently across pages. */
import type { PredictionOut } from "@/api/schemas";
import type { SignalClass } from "@/api/types";
import { asGrade } from "@/components/science/adapters";
import { verdictClass } from "@/components/science/verdict";

/**
 * The displayed class of a stored prediction. Uses the same conservative rule as the VerdictPanel:
 * uncertain when the ±1σ band straddles the threshold or the input quality is grade D.
 */
export function predictionClass(p: Pick<PredictionOut, "probability" | "threshold" | "uncertainty" | "quality_grade" | "predicted_label">): SignalClass {
  const threshold = p.threshold ?? 0.5;
  return verdictClass(p.probability, threshold, p.uncertainty, asGrade(p.quality_grade));
}

export const SPLIT_TEXT: Record<"train" | "val" | "test", string> = {
  train: "In the model's training split — the score is optimistic.",
  val: "In the model's validation split — the threshold was tuned on it.",
  test: "In the model's held-out test split — a fair score.",
};

export function splitNote(split: PredictionOut["seen_in_split"]): string {
  return split ? SPLIT_TEXT[split] : "Not in the model's dataset — an unseen star.";
}
