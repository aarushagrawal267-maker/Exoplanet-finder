/**
 * ConfusionMatrix — 2×2 grid of counts at the chosen decision threshold.
 *
 * Rows are the catalogue (true) class, columns the model's predicted class. Each cell shows the
 * count and its share of the row (so the diagonal reads as recall / specificity). Cell shading is
 * a single-hue sequential scale on the row share; correctness is labelled in text, not colour.
 */
import { cn } from "@/lib/cn";
import { formatInt, formatPercent, formatProbability } from "@/lib/format";

export interface ConfusionMatrixProps {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  threshold?: number;
  /** Class names (default planet-like / false-positive-like). */
  positiveLabel?: string;
  negativeLabel?: string;
  className?: string;
}

function Cell({ count, rowTotal, correct, caption }: { count: number; rowTotal: number; correct: boolean; caption: string }) {
  const share = rowTotal > 0 ? count / rowTotal : 0;
  return (
    <div
      className="flex min-h-[92px] flex-col justify-between rounded-md border border-hairline p-3"
      style={{ background: `rgba(110, 155, 255, ${0.04 + share * 0.26})` }}
    >
      {/* Both rows wrap as whole words in narrow cells (phones, two-up layouts) instead of
          breaking "TRUE POS." or squeezing the share against the count. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
        <span className="eyebrow whitespace-nowrap text-fg-secondary">{caption}</span>
        <span className={cn("whitespace-nowrap text-2xs font-medium uppercase tracking-[0.1em]", correct ? "text-fg" : "text-fg-secondary")}>
          {correct ? "correct" : "error"}
        </span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="num text-xl font-medium text-fg">{formatInt(count)}</span>
        <span className="num text-sm text-fg-secondary">{formatPercent(share, { digits: 1 })}</span>
      </div>
    </div>
  );
}

export function ConfusionMatrix({
  tp,
  fp,
  tn,
  fn,
  threshold,
  positiveLabel = "Planet-like",
  negativeLabel = "False-positive-like",
  className,
}: ConfusionMatrixProps) {
  const pos = tp + fn;
  const neg = tn + fp;
  return (
    <figure
      className={cn("m-0", className)}
      aria-label={`Confusion matrix${threshold !== undefined ? ` at threshold ${formatProbability(threshold)}` : ""}: ${tp} true positives, ${fn} false negatives, ${fp} false positives, ${tn} true negatives`}
    >
      <div className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)]">
        <div />
        <div className="eyebrow pb-1 text-fg-secondary">
          Predicted <span className="normal-case tracking-normal text-fg">{positiveLabel}</span>
        </div>
        <div className="eyebrow pb-1 text-fg-secondary">
          Predicted <span className="normal-case tracking-normal text-fg">{negativeLabel}</span>
        </div>

        <div className="flex items-center">
          <span className="eyebrow text-fg-secondary">
            Actual <span className="block normal-case tracking-normal text-fg">{positiveLabel}</span>
          </span>
        </div>
        <Cell count={tp} rowTotal={pos} correct caption="True pos." />
        <Cell count={fn} rowTotal={pos} correct={false} caption="False neg." />

        <div className="flex items-center">
          <span className="eyebrow text-fg-secondary">
            Actual <span className="block break-words normal-case tracking-normal text-fg">{negativeLabel}</span>
          </span>
        </div>
        <Cell count={fp} rowTotal={neg} correct={false} caption="False pos." />
        <Cell count={tn} rowTotal={neg} correct caption="True neg." />
      </div>
      <figcaption className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-fg-secondary">
        <span>
          n = <span className="num text-fg">{formatInt(pos + neg)}</span> · {positiveLabel} <span className="num text-fg">{formatInt(pos)}</span> ·{" "}
          {negativeLabel} <span className="num text-fg">{formatInt(neg)}</span>
        </span>
        {threshold !== undefined ? (
          <span>
            threshold <span className="num text-fg">{formatProbability(threshold)}</span>
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
