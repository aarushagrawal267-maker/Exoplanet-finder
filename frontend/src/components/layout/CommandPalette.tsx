/**
 * Command palette (Ctrl/⌘ + K): jump to any page, and — through the `onSearch` hook — to
 * targets (KIC ids, Kepler names, KOIs) once the search API is wired. Full keyboard support:
 * ↑/↓ to move, Enter to open, Esc to close. Implements the WAI-ARIA combobox + listbox pattern.
 */
import { CornerDownLeft, LoaderCircle, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Kbd } from "@/components/ui/Badge";
import { Portal, useDialogBehaviour } from "@/components/ui/overlay";
import { cn } from "@/lib/cn";
import { useDebouncedValue } from "@/lib/hooks";
import { ALL_NAV_ITEMS, HIDDEN_ROUTES, NAV_GROUPS, type NavIcon } from "./nav";

export interface CommandItem {
  id: string;
  label: string;
  /** Section heading, e.g. "Pages" or "Targets". */
  group: string;
  description?: string;
  icon?: NavIcon;
  /** Right-aligned hint (mono), e.g. a KIC id. */
  hint?: string;
  keywords?: string[];
  /** Route to navigate to, or a custom action. */
  path?: string;
  perform?: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Navigate to a path (react-router's navigate). */
  onNavigate: (path: string) => void;
  /** Async search hook for non-page results (targets). Receives the raw query. */
  onSearch?: (query: string, signal: AbortSignal) => Promise<CommandItem[]>;
  /** Extra static commands. */
  extraItems?: CommandItem[];
}

/** Page entries derived from the navigation model. */
export function pageCommands(): CommandItem[] {
  const groupOf = new Map(NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.id, g.label] as const)));
  return [
    ...ALL_NAV_ITEMS.map((i) => ({
      id: `page:${i.id}`,
      label: i.label,
      group: "Pages",
      description: i.description,
      icon: i.icon,
      hint: groupOf.get(i.id),
      keywords: i.keywords,
      path: i.path,
    })),
    ...HIDDEN_ROUTES.filter((r) => !r.path.includes(":")).map((r) => ({
      id: `page:${r.id}`,
      label: r.label,
      group: "Pages",
      description: r.description,
      icon: r.icon,
      hint: r.groupLabel,
      keywords: r.keywords,
      path: r.path,
    })),
  ];
}

/**
 * Score how well `item` matches `query` (higher is better; 0 = no match):
 * label prefix > word prefix > label substring > keyword/description substring > subsequence.
 */
export function matchScore(item: Pick<CommandItem, "label" | "keywords" | "description" | "hint">, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 100;
  if (label.split(/\s+/).some((w) => w.startsWith(q))) return 80;
  if (label.includes(q)) return 60;
  const extra = [...(item.keywords ?? []), item.description ?? "", item.hint ?? ""].join(" ").toLowerCase();
  if (extra.includes(q)) return 40;
  let i = 0;
  for (const ch of label) if (ch === q[i]) i += 1;
  return i === q.length ? 20 : 0;
}

export function CommandPalette({ open, onClose, onNavigate, onSearch, extraItems = [] }: CommandPaletteProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<CommandItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounced = useDebouncedValue(query, 200);
  useDialogBehaviour(ref, open, onClose, inputRef);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setRemote([]);
      setSearchError(null);
    }
  }, [open]);

  // Remote search (targets), debounced and abortable.
  useEffect(() => {
    if (!open || !onSearch || debounced.trim().length < 2) {
      setRemote([]);
      setSearching(false);
      return undefined;
    }
    const ctrl = new AbortController();
    setSearching(true);
    setSearchError(null);
    onSearch(debounced.trim(), ctrl.signal)
      .then((items) => {
        if (!ctrl.signal.aborted) setRemote(items);
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) {
          setRemote([]);
          setSearchError(err instanceof Error ? err.message : "Search failed");
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setSearching(false);
      });
    return () => ctrl.abort();
  }, [debounced, open, onSearch]);

  const results = useMemo(() => {
    const local = [...pageCommands(), ...extraItems]
      .map((item) => ({ item, score: matchScore(item, query) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.item);
    return [...local, ...remote];
  }, [query, remote, extraItems]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const choose = (item: CommandItem | undefined) => {
    if (!item) return;
    onClose();
    if (item.perform) item.perform();
    else if (item.path) onNavigate(item.path);
  };

  if (!open) return null;

  // Group for rendering while keeping a flat index for keyboard navigation.
  const groups: Array<{ name: string; entries: Array<{ item: CommandItem; index: number }> }> = [];
  results.forEach((item, index) => {
    const g = groups.find((x) => x.name === item.group);
    if (g) g.entries.push({ item, index });
    else groups.push({ name: item.group, entries: [{ item, index }] });
  });

  let footerNote: ReactNode = null;
  if (searching) footerNote = (
    <span className="flex items-center gap-1.5">
      <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> Searching targets…
    </span>
  );
  else if (searchError) footerNote = <span className="text-warn">Target search unavailable: {searchError}</span>;
  else if (!onSearch) footerNote = <span>Target search becomes available once the catalogue is loaded.</span>;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[10vh] sm:px-6">
        <div className="absolute inset-0 animate-fade-in bg-void/75 backdrop-blur-[2px]" aria-hidden="true" onClick={onClose} />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="card-surface relative w-full max-w-xl animate-rise-in overflow-hidden bg-surface-raised p-0 shadow-[0_24px_64px_-12px_rgb(0_0_0/0.7)]"
        >
          <div className="flex items-center gap-3 border-b border-hairline px-4">
            <Search className="size-4 shrink-0 text-fg-secondary" aria-hidden="true" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={results.length ? `${listId}-opt-${active}` : undefined}
              aria-label="Search pages and targets"
              placeholder="Jump to a page, or search KIC id / Kepler name…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => (results.length ? (a + 1) % results.length : 0));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  choose(results[active]);
                }
              }}
              className="h-12 w-full bg-transparent text-md text-fg placeholder:text-fg-muted focus:outline-none"
            />
            <Kbd>Esc</Kbd>
          </div>
          <ul id={listId} role="listbox" aria-label="Results" className="max-h-[min(420px,60vh)] overflow-y-auto p-2">
            {results.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-fg-secondary" role="presentation">
                No pages match “{query}”.
              </li>
            ) : (
              groups.map((g) => (
                <li key={g.name} role="presentation">
                  {/* Visual heading only: the group is named by aria-label, and a listbox may
                      expose only groups and options to assistive technology. */}
                  <div className="eyebrow px-3 pb-1 pt-2 text-fg-secondary" aria-hidden="true">
                    {g.name}
                  </div>
                  <ul role="group" aria-label={g.name}>
                    {g.entries.map(({ item, index }) => {
                      const Icon = item.icon;
                      const selected = index === active;
                      return (
                        <li
                          key={item.id}
                          id={`${listId}-opt-${index}`}
                          role="option"
                          aria-selected={selected}
                          onMouseMove={() => setActive(index)}
                          onClick={() => choose(item)}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2",
                            selected ? "bg-cosmic/[0.12] text-fg" : "text-fg-secondary",
                          )}
                        >
                          {Icon ? <Icon size={16} strokeWidth={1.75} className={selected ? "text-cosmic" : "text-fg-secondary"} /> : null}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-base text-fg">{item.label}</span>
                            {item.description ? <span className="block truncate text-xs text-fg-secondary">{item.description}</span> : null}
                          </span>
                          {item.hint ? <span className="num shrink-0 text-xs text-fg-secondary">{item.hint}</span> : null}
                          {selected ? <CornerDownLeft className="size-3.5 shrink-0 text-fg-secondary" aria-hidden="true" /> : null}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-2 text-xs text-fg-secondary">
            <span className="min-w-0 truncate">{footerNote}</span>
            <span className="hidden shrink-0 items-center gap-1 sm:flex">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate <Kbd className="ml-2">Enter</Kbd> open
            </span>
          </div>
        </div>
      </div>
    </Portal>
  );
}
