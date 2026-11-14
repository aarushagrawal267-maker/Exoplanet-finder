/**
 * ProvenanceTable — catalogue vs measured vs estimated values side by side.
 *
 * Catalogue = NASA Exoplanet Archive; measured = this app's pipeline on the light curve; estimate
 * = derived with stated assumptions (e.g. planet radius from depth × stellar radius, which assumes
 * no dilution and a central transit). The last column quantifies agreement between measured and
 * catalogue values: the difference in combined standard errors when both have uncertainties
 * (|m − c| / √(σm² + σc²)), otherwise the ratio m / c.
 */
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatNumber, formatSigma, isFiniteNumber } from "@/lib/format";
import { ProvenanceChip } from "@/components/ui/ProvenanceChip";

export interface ProvenanceCell {
  value: number | null;
  err?: number | null;
  source?: string;
}

export interface ProvenanceRow {
  quantity: string;
  unit: string;
  digits?: number;
  catalogue?: ProvenanceCell | null;
  measured?: ProvenanceCell | null;
  estimate?: ProvenanceCell | null;
  /** Footnote for estimates (assumptions). */
  note?: string;
}

export interface ProvenanceTableProps {
  rows: ProvenanceRow[];
  caption?: string;
  className?: string;
}

/** Agreement between measured and catalogue values (see module doc). */
export function agreement(measured?: ProvenanceCell | null, catalogue?: ProvenanceCell | null): { text: string; tension: boolean } | null {
  if (!measured || !catalogue || !isFiniteNumber(measured.value) || !isFiniteNumber(catalogue.value)) return null;
  const em = measured.err;
  const ec = catalogue.err;
  if (isFiniteNumber(em) && isFiniteNumber(ec) && em > 0 && ec > 0) {
    const sigma = Math.abs(measured.value - catalogue.value) / Math.sqrt(em * em + ec * ec);
    return { text: formatSigma(sigma), tension: sigma >= 3 };
  }
  if (catalogue.value === 0) return null;
  const ratio = measured.value / catalogue.value;
  return { text: `×${formatNumber(ratio, { digits: 2 })}`, tension: ratio < 0.5 || ratio > 2 };
}

/**
 * A missing value: an em dash in secondary ink (text-muted is below WCAG AA for text), announced
 * as "not available" rather than read as punctuation or skipped.
 */
function Missing() {
  return (
    <span className="text-fg-secondary">
      <span aria-hidden="true">—</span>
      <span className="sr-only">not available</span>
    </span>
  );
}

function Value({ cell, digits }: { cell?: ProvenanceCell | null; digits: number }) {
  if (!cell || !isFiniteNumber(cell.value)) return <Missing />;
  return (
    <span title={cell.source}>
      {formatNumber(cell.value, { digits })}
      {isFiniteNumber(cell.err) ? <span className="text-fg-secondary"> ± {formatNumber(cell.err, { digits })}</span> : null}
    </span>
  );
}

export function ProvenanceTable({ rows, caption = "Catalogue, measured and estimated values", className }: ProvenanceTableProps) {
  const notes = rows.filter((r) => r.note);
  return (
    <div className={cn("card-surface overflow-hidden p-0", className)}>
      {/* relative: keeps visually-hidden (absolute) text inside the scroll box on narrow screens */}
      <div className="relative overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-base" aria-label={caption}>
          <thead>
            <tr className="bg-space">
              <th scope="col" className="eyebrow h-10 border-b border-hairline px-4 text-left font-medium text-fg-secondary">
                Quantity
              </th>
              <th scope="col" className="h-10 border-b border-hairline px-3 text-right">
                <ProvenanceChip kind="catalogue" />
              </th>
              <th scope="col" className="h-10 border-b border-hairline px-3 text-right">
                <ProvenanceChip kind="measured" />
              </th>
              <th scope="col" className="h-10 border-b border-hairline px-3 text-right">
                <ProvenanceChip kind="estimate" />
              </th>
              <th scope="col" className="eyebrow h-10 border-b border-hairline px-4 text-right font-medium text-fg-secondary">
                <abbr title="Agreement between measured and catalogue values" className="no-underline">
                  Agreement
                </abbr>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const a = agreement(r.measured, r.catalogue);
              const d = r.digits ?? 2;
              return (
                <tr key={r.quantity} className="group">
                  <th scope="row" className="h-11 border-b border-hairline px-4 text-left font-normal group-last:border-b-0">
                    <span className="text-fg">{r.quantity}</span>
                    <span className="num ml-1.5 text-xs text-fg-secondary">{r.unit}</span>
                    {r.note ? (
                      <sup className="num ml-0.5 text-2xs text-fg-secondary" aria-label={`note ${notes.indexOf(r) + 1}`}>
                        {notes.indexOf(r) + 1}
                      </sup>
                    ) : null}
                  </th>
                  <td className="num whitespace-nowrap border-b border-hairline px-3 text-right text-fg group-last:border-b-0">
                    <Value cell={r.catalogue} digits={d} />
                  </td>
                  <td className="num whitespace-nowrap border-b border-hairline px-3 text-right text-fg group-last:border-b-0">
                    <Value cell={r.measured} digits={d} />
                  </td>
                  <td className="num whitespace-nowrap border-b border-hairline px-3 text-right text-fg group-last:border-b-0">
                    <Value cell={r.estimate} digits={d} />
                  </td>
                  <td className="num whitespace-nowrap border-b border-hairline px-4 text-right group-last:border-b-0">
                    {a ? (
                      a.tension ? (
                        <span className="inline-flex items-center gap-1 text-warn" title="Measured and catalogue values are in tension">
                          <TriangleAlert className="size-3.5" aria-hidden="true" />
                          {a.text}
                          <span className="sr-only"> (tension)</span>
                        </span>
                      ) : (
                        <span className="text-fg-secondary">{a.text}</span>
                      )
                    ) : (
                      <Missing />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {notes.length ? (
        <ol className="flex flex-col gap-1 border-t border-hairline bg-space/60 px-4 py-3 text-xs text-fg-secondary">
          {notes.map((r, i) => (
            <li key={r.quantity}>
              <span className="num mr-1.5">{i + 1}</span>
              {r.note}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
