/**
 * DataTable — TanStack Table (sorting) + TanStack Virtual (row virtualisation) in a single native
 * <table> so header and body columns always align.
 *
 * - Sticky header; click a header (or press Enter/Space on it) to sort. Numeric columns
 *   (`meta.numeric`) sort descending first, are right-aligned and rendered in mono tabular
 *   numerals. Missing values should be `undefined` so they always sort last.
 * - Rows are virtualised automatically above `virtualizeThreshold` rows (padding-row technique).
 * - Density toggle (comfortable 40 px / compact 32 px rows) and a built-in empty state.
 * - `manualSorting` for server-sorted, server-paginated data (the header still drives the state).
 */
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown, Rows3, Rows4 } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { EmptyState } from "./EmptyState";
import { SegmentedControl } from "./SegmentedControl";
import { Skeleton } from "./Skeleton";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Right-aligned, mono, tabular numerals; sorts descending first. */
    numeric?: boolean;
    /** Mono text without right alignment (IDs, codes). */
    mono?: boolean;
    align?: "left" | "right" | "center";
    /** CSS width of the column (e.g. 120 or "20%"). */
    width?: number | string;
    /** Full header text for screen readers when the visible header is abbreviated. */
    headerLabel?: string;
  }
}

export type Density = "comfortable" | "compact";
const ROW_HEIGHT: Record<Density, number> = { comfortable: 40, compact: 32 };

export interface DataTableProps<T> {
  data: T[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  /** Accessible name of the table. */
  caption: string;
  getRowId?: (row: T, index: number) => string;
  initialSorting?: SortingState;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  /** Rows arrive already sorted by the server: sorting only updates state (see `onSortingChange`). */
  manualSorting?: boolean;
  density?: Density;
  defaultDensity?: Density;
  onDensityChange?: (d: Density) => void;
  showDensityToggle?: boolean;
  /** Content on the left of the toolbar (filters, counts…). */
  toolbar?: ReactNode;
  /** Max height of the scroll area (the header stays sticky inside it). */
  maxHeight?: number | string;
  /** "auto" virtualises above `virtualizeThreshold` rows. */
  virtualize?: boolean | "auto";
  virtualizeThreshold?: number;
  onRowClick?: (row: T) => void;
  /** Highlight a selected row by id. */
  selectedRowId?: string | null;
  loading?: boolean;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  emptyActions?: ReactNode;
  className?: string;
}

export function DataTable<T>({
  data,
  columns,
  caption,
  getRowId,
  initialSorting = [],
  sorting: sortingProp,
  onSortingChange,
  manualSorting = false,
  density: densityProp,
  defaultDensity = "comfortable",
  onDensityChange,
  showDensityToggle = true,
  toolbar,
  maxHeight = 520,
  virtualize = "auto",
  virtualizeThreshold = 80,
  onRowClick,
  selectedRowId,
  loading = false,
  emptyTitle = "No rows to show",
  emptyDescription,
  emptyActions,
  className,
}: DataTableProps<T>) {
  const [innerSorting, setInnerSorting] = useState<SortingState>(initialSorting);
  const [innerDensity, setInnerDensity] = useState<Density>(defaultDensity);
  const sorting = sortingProp ?? innerSorting;
  const density = densityProp ?? innerDensity;

  // Defaults: numeric columns sort descending first; missing values (undefined) always last.
  const cols = useMemo(
    () =>
      columns.map((c) => ({
        sortUndefined: "last" as const,
        sortDescFirst: Boolean(c.meta?.numeric),
        ...c,
      })),
    [columns],
  );

  const table = useReactTable({
    data,
    columns: cols,
    state: { sorting },
    onSortingChange: onSortingChange ?? setInnerSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    manualSorting,
    getRowId,
    enableSortingRemoval: true,
  });

  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowHeight = ROW_HEIGHT[density];
  const useVirtual = virtualize === true || (virtualize === "auto" && rows.length > virtualizeThreshold);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    enabled: useVirtual,
    initialRect: { width: 800, height: typeof maxHeight === "number" ? maxHeight : 520 },
  });

  const virtualItems = useVirtual ? virtualizer.getVirtualItems() : [];
  const totalSize = useVirtual ? virtualizer.getTotalSize() : 0;
  const padTop = useVirtual && virtualItems.length ? (virtualItems[0]?.start ?? 0) : 0;
  const padBottom = useVirtual && virtualItems.length ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0) : 0;
  const visible = useVirtual
    ? virtualItems.flatMap((v) => (rows[v.index] ? [{ row: rows[v.index] as (typeof rows)[number], pos: v.index }] : []))
    : rows.map((row, pos) => ({ row, pos }));
  const colCount = table.getVisibleLeafColumns().length;

  const setDensity = (d: Density) => {
    if (densityProp === undefined) setInnerDensity(d);
    onDensityChange?.(d);
  };

  const alignClass = (meta: { numeric?: boolean; align?: string } | undefined) =>
    meta?.align === "center" ? "text-center" : meta?.numeric || meta?.align === "right" ? "text-right" : "text-left";

  return (
    <div className={cn("card-surface flex flex-col overflow-hidden p-0", className)}>
      {toolbar || showDensityToggle ? (
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-fg-secondary">{toolbar}</div>
          {showDensityToggle ? (
            <SegmentedControl<Density>
              aria-label="Row density"
              size="sm"
              value={density}
              onChange={setDensity}
              options={[
                { value: "comfortable", label: null, icon: <Rows3 />, ariaLabel: "Comfortable rows" },
                { value: "compact", label: null, icon: <Rows4 />, ariaLabel: "Compact rows" },
              ]}
            />
          ) : null}
        </div>
      ) : null}
      <div ref={scrollRef} className="relative overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-separate border-spacing-0 text-base" aria-label={caption} aria-rowcount={rows.length + 1}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const label = header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext());
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : canSort ? "none" : undefined}
                      style={{ width: meta?.width }}
                      className={cn(
                        "sticky top-0 z-10 h-9 whitespace-nowrap border-b border-hairline bg-space px-3 first:pl-4 last:pr-4",
                        "eyebrow font-medium text-fg-secondary",
                        alignClass(meta),
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "group inline-flex items-center gap-1 rounded-sm uppercase tracking-[inherit] hover:text-fg",
                            (meta?.numeric || meta?.align === "right") && "flex-row-reverse",
                            sorted && "text-fg",
                          )}
                          title={meta?.headerLabel}
                        >
                          <span>{label}</span>
                          {meta?.headerLabel ? <span className="sr-only">({meta.headerLabel})</span> : null}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3 text-cosmic" aria-hidden="true" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3 text-cosmic" aria-hidden="true" />
                          ) : (
                            <ChevronsUpDown className="size-3 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }, (_, i) => (
                <tr key={`sk-${i}`} style={{ height: rowHeight }}>
                  {Array.from({ length: colCount }, (__, j) => (
                    <td key={j} className="border-b border-hairline px-3 first:pl-4 last:pr-4">
                      <Skeleton height={10} width={j === 0 ? "70%" : "50%"} className={j === 0 ? "" : "ml-auto"} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? null : (
              <>
                {padTop > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={colCount} style={{ height: padTop, padding: 0 }} />
                  </tr>
                ) : null}
                {visible.map(({ row, pos }) => {
                  const selected = selectedRowId !== undefined && selectedRowId !== null && row.id === selectedRowId;
                  return (
                    <tr
                      key={row.id}
                      data-row-id={row.id}
                      aria-rowindex={pos + 2}
                      // aria-selected is only valid on rows of a grid/treegrid; in a plain table the
                      // highlighted row is announced as the current item instead.
                      aria-current={selected ? "true" : undefined}
                      data-selected={selected || undefined}
                      style={{ height: rowHeight }}
                      tabIndex={onRowClick ? 0 : undefined}
                      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                      onKeyDown={
                        onRowClick
                          ? (e) => {
                              if (e.key === "Enter") onRowClick(row.original);
                            }
                          : undefined
                      }
                      className={cn(
                        "transition-colors duration-fast",
                        onRowClick && "cursor-pointer hover:bg-fg/[0.035] focus-visible:bg-cosmic/[0.06] focus-visible:outline-none",
                        selected && "bg-cosmic/[0.08]",
                      )}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const meta = cell.column.columnDef.meta;
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              "whitespace-nowrap border-b border-hairline px-3 text-fg first:pl-4 last:pr-4",
                              density === "compact" ? "text-sm" : "text-base",
                              alignClass(meta),
                              (meta?.numeric || meta?.mono) && "num",
                              selected && "first:shadow-[inset_2px_0_0_var(--c-cosmic)]",
                            )}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {padBottom > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={colCount} style={{ height: padBottom, padding: 0 }} />
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
      {/* Outside the scroll box, so on narrow screens the message is not pushed off to the right
          by a wide header row. */}
      {!loading && rows.length === 0 ? (
        <div className="border-t border-hairline p-4">
          <EmptyState size="sm" atmosphere={false} title={emptyTitle} description={emptyDescription} actions={emptyActions} className="border-none" />
        </div>
      ) : null}
    </div>
  );
}

/** Accessor helper mapping null → undefined so missing values always sort last. */
export function missingAsUndefined<T, V>(fn: (row: T) => V | null | undefined): (row: T) => V | undefined {
  return (row) => {
    const v = fn(row);
    return v === null ? undefined : v;
  };
}
