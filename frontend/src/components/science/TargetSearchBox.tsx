/**
 * Star search combobox (WAI-ARIA combobox + listbox) over `GET /api/targets/search`: KIC ids,
 * Kepler names ("Kepler-90", "Kepler-90 h"), KOI names ("K00351.01") and signal keys.
 */
import { LoaderCircle, Search } from "lucide-react";
import { useId, useState } from "react";
import { useTargetSearch } from "@/api/endpoints/targets";
import type { TargetSearchResult } from "@/api/schemas";
import { errorParts } from "@/components/ui/ApiErrorBanner";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { useDebouncedValue } from "@/lib/hooks";
import { LcStatusBadge } from "./CatalogueLabels";

export interface TargetSearchBoxProps {
  onSelect: (result: TargetSearchResult) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function TargetSearchBox({ onSelect, label = "Search the catalogue", placeholder = "KIC id, Kepler-90, Kepler-90 h, K00351.01…", autoFocus, className }: TargetSearchBoxProps) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(q, 200);
  const search = useTargetSearch(debounced, { limit: 10 });
  const results = debounced.trim() ? (search.data ?? []) : [];
  const listId = `${id}-list`;
  const showList = open && debounced.trim().length > 0;

  const choose = (r: TargetSearchResult | undefined) => {
    if (!r) return;
    onSelect(r);
    setOpen(false);
    setQ("");
  };

  return (
    <div className={cn("relative", className)}>
      <label htmlFor={`${id}-input`} className="mb-1.5 block text-sm font-medium text-fg">
        {label}
      </label>
      <Input
        id={`${id}-input`}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results.length ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        leading={<Search aria-hidden="true" />}
        trailing={search.isFetching ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : undefined}
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (results.length ? (a + 1) % results.length : 0));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching stars"
          className="card-surface absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto bg-surface-raised p-1 shadow-[0_16px_48px_-12px_rgb(0_0_0/0.7)]"
        >
          {search.isError ? (
            <li role="presentation" className="px-3 py-3 text-sm text-danger">
              {errorParts(search.error).detail}
            </li>
          ) : results.length === 0 ? (
            <li role="presentation" className="px-3 py-3 text-sm text-fg-secondary">
              {search.isFetching || debounced !== q ? "Searching…" : `No star matches “${debounced}”.`}
            </li>
          ) : (
            results.map((r, i) => (
              <li
                key={`${r.kepid}-${r.matched_signal_id ?? ""}`}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(r)}
                className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2", i === active ? "bg-cosmic/[0.12]" : "")}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-fg">{r.matched_name ? `${r.matched_name} — ${r.label}` : r.label}</span>
                  <span className="num block text-xs text-fg-secondary">
                    {r.n_signals} signal{r.n_signals === 1 ? "" : "s"} · matched on {r.matched_on.replace(/_/g, " ")}
                  </span>
                </span>
                <LcStatusBadge status={r.lc_status} className="shrink-0" />
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
