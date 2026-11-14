import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ToggleChipOption {
  value: string;
  label: ReactNode;
  /** Optional count shown in mono after the label. */
  count?: number;
  title?: string;
}

export interface ToggleChipsProps {
  options: ReadonlyArray<ToggleChipOption>;
  /** Selected values; empty = no filter. */
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Accessible name of the group, e.g. "Catalogue category". */
  label: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Multi-select filter chips (toggle buttons with aria-pressed). An empty selection means "any".
 * Selected chips show a check mark as well as the cosmic outline, so state is not colour-only.
 */
export function ToggleChips({ options, value, onChange, label, size = "sm", className }: ToggleChipsProps) {
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            title={o.title}
            onClick={() => toggle(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors duration-fast [&_svg]:size-3",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
              on ? "border-cosmic/70 bg-cosmic/10 text-fg" : "border-hairline-strong text-fg-secondary hover:border-fg-muted hover:text-fg",
            )}
          >
            {on ? <Check className="text-cosmic" aria-hidden="true" /> : null}
            {o.label}
            {o.count !== undefined ? <span className="num text-fg-secondary">{o.count.toLocaleString("en-US")}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
