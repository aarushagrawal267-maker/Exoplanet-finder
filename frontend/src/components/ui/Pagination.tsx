import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { Button } from "./Button";
import { Select } from "./Select";

export interface PaginationProps {
  /** Total number of rows on the server. */
  total: number;
  offset: number;
  limit: number;
  onChange: (offset: number, limit: number) => void;
  /** Page-size choices (omit to hide the selector). */
  pageSizes?: number[];
  /** Noun for the count, e.g. "signals". */
  noun?: string;
  /** True while the next page is loading (keeps the old page visible). */
  busy?: boolean;
  className?: string;
}

/** Offset/limit pager for server-side tables: "1–50 of 22,644 signals" + previous / next. */
export function Pagination({ total, offset, limit, onChange, pageSizes, noun = "rows", busy = false, className }: PaginationProps) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(total, offset + limit);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <nav aria-label="Pagination" className={cn("flex flex-wrap items-center justify-between gap-3 text-sm text-fg-secondary", className)}>
      <p aria-live="polite" className={cn("num", busy && "opacity-60")}>
        {formatInt(from)}–{formatInt(to)} of {formatInt(total)} {noun}
      </p>
      <div className="flex items-center gap-2">
        {pageSizes && pageSizes.length > 1 ? (
          <Select
            size="sm"
            aria-label="Rows per page"
            className="w-[92px]"
            mono
            value={String(limit)}
            onChange={(v) => onChange(0, Number(v))}
            options={pageSizes.map((n) => ({ value: String(n), label: `${n} / page` }))}
          />
        ) : null}
        <span className="num hidden whitespace-nowrap sm:inline">
          page {formatInt(page)} / {formatInt(pages)}
        </span>
        <Button size="sm" variant="secondary" iconOnly aria-label="Previous page" icon={<ChevronLeft />} disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit), limit)} />
        <Button size="sm" variant="secondary" iconOnly aria-label="Next page" icon={<ChevronRight />} disabled={offset + limit >= total} onClick={() => onChange(offset + limit, limit)} />
      </div>
    </nav>
  );
}
