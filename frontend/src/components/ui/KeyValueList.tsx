import type { ReactNode } from "react";
import type { Provenance } from "@/api/types";
import { cn } from "@/lib/cn";
import { ProvenanceChip } from "./ProvenanceChip";

export interface KeyValueItem {
  key: string;
  label: ReactNode;
  value: ReactNode;
  /** Render the value in mono tabular numerals (default true). */
  mono?: boolean;
  provenance?: Provenance;
  hint?: ReactNode;
}

export interface KeyValueListProps {
  items: KeyValueItem[];
  columns?: 1 | 2;
  dense?: boolean;
  className?: string;
}

/** Definition list of labelled values (target metadata, configs, environment info). */
export function KeyValueList({ items, columns = 1, dense = false, className }: KeyValueListProps) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-8", columns === 2 && "sm:grid-cols-2", className)}>
      {items.map((item) => (
        <div
          key={item.key}
          // Wraps (value under label, right-aligned) when a long value does not fit beside its label.
          className={cn("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-hairline last:border-b-0", dense ? "py-1.5" : "py-2.5", columns === 2 && "sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0")}
        >
          <dt className="min-w-0 text-sm text-fg-secondary">
            {item.label}
            {item.hint ? <div className="text-xs text-fg-secondary/80">{item.hint}</div> : null}
          </dt>
          <dd className={cn("ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1 break-words text-right text-base text-fg", item.mono !== false && "num")}>
            {item.value}
            {item.provenance ? <ProvenanceChip kind={item.provenance} size="xs" /> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
