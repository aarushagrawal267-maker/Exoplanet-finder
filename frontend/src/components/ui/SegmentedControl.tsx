import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Accessible name when `label` is icon-only. */
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
  size?: "sm" | "md";
  className?: string;
}

/** Single-choice toggle group (radiogroup semantics, arrow-key navigation). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  ...aria
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent) => {
    const enabled = options.map((o, i) => ({ o, i })).filter(({ o }) => !o.disabled);
    const pos = enabled.findIndex(({ o }) => o.value === value);
    let next: (typeof enabled)[number] | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = enabled[(pos + 1) % enabled.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = enabled[(pos - 1 + enabled.length) % enabled.length];
    if (!next) return;
    e.preventDefault();
    onChange(next.o.value);
    refs.current[next.i]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={aria["aria-label"]}
      onKeyDown={onKeyDown}
      className={cn("inline-flex items-center gap-0.5 rounded-md border border-hairline-strong bg-space p-0.5", className)}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.ariaLabel}
            tabIndex={checked ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-[5px] font-medium transition-colors duration-fast [&_svg]:shrink-0",
              size === "sm" ? "h-6 px-2 text-xs [&_svg]:size-3.5" : "h-7 px-2.5 text-sm [&_svg]:size-4",
              checked
                ? "bg-surface-raised text-fg shadow-[inset_0_0_0_1px_var(--c-hairline-strong)]"
                : "text-fg-secondary hover:text-fg",
              "disabled:opacity-40",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
