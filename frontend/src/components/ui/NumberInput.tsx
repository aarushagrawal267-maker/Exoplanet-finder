import { Minus, Plus } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./Field";
import { controlClasses } from "./Input";

export interface NumberInputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Decimal places used when re-formatting on blur (default: inferred from `step`). */
  precision?: number;
  unit?: string;
  /** Allow clearing the field (value null). Default false: empty input reverts on blur. */
  allowEmpty?: boolean;
  /** Hide the −/+ stepper buttons. */
  hideSteppers?: boolean;
  size?: "sm" | "md";
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  className?: string;
}

function decimalsOf(step: number): number {
  const s = String(step);
  return s.includes(".") ? (s.split(".")[1]?.length ?? 0) : 0;
}

function clamp(v: number, min?: number, max?: number): number {
  let out = v;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

/**
 * Numeric entry with mono tabular digits, optional unit suffix and −/+ steppers.
 * Typing is free-form; valid numbers are committed immediately (clamped to [min, max]) and the
 * text is normalised on blur. ↑/↓ step by `step` (×10 with Shift).
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  precision,
  unit,
  allowEmpty = false,
  hideSteppers = false,
  size = "md",
  disabled,
  placeholder,
  className,
  ...rest
}: NumberInputProps) {
  const field = useFieldControl(rest);
  const digits = precision ?? decimalsOf(step);
  const fmt = (v: number | null) => (v === null || !Number.isFinite(v) ? "" : v.toFixed(digits));
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);

  // Follow external value changes while the user is not editing.
  useEffect(() => {
    if (!focused) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused, digits]);

  const commit = (raw: string) => {
    const trimmed = raw.trim().replace(/−/g, "-");
    if (trimmed === "") {
      if (allowEmpty) onChange(null);
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n)) onChange(clamp(n, min, max));
  };

  const nudge = (dir: 1 | -1, mult = 1) => {
    const baseValue = value ?? min ?? 0;
    const next = clamp(Number((baseValue + dir * step * mult).toFixed(digits + 2)), min, max);
    onChange(next);
    setText(fmt(next));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      nudge(e.key === "ArrowUp" ? 1 : -1, e.shiftKey ? 10 : 1);
    } else if (e.key === "Enter") {
      commit(text);
    }
  };

  const invalidText = text.trim() !== "" && !Number.isFinite(Number(text.trim().replace(/−/g, "-")));
  const stepBtn =
    "flex h-full w-7 items-center justify-center text-fg-secondary transition-colors hover:bg-fg/[0.06] hover:text-fg disabled:opacity-40 [&_svg]:size-3.5";

  return (
    <div className={cn("relative flex items-stretch", size === "sm" ? "h-8" : "h-9", className)}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        name={rest.name}
        aria-label={rest["aria-label"]}
        id={field.id}
        aria-describedby={field["aria-describedby"]}
        aria-invalid={invalidText || field["aria-invalid"] ? true : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value ?? undefined}
        role="spinbutton"
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value.trim().replace(/−/g, "-");
          if (t !== "" && t !== "-" && t !== "." && Number.isFinite(Number(t))) {
            const n = Number(t);
            if ((min === undefined || n >= min) && (max === undefined || n <= max)) onChange(n);
          } else if (t === "" && allowEmpty) {
            onChange(null);
          }
        }}
        onBlur={() => {
          setFocused(false);
          commit(text);
          setText(fmt(text.trim() === "" && allowEmpty ? null : value));
        }}
        onKeyDown={onKeyDown}
        className={cn(
          controlClasses,
          "num h-full text-right",
          size === "sm" ? "text-sm" : "text-base",
          hideSteppers ? "px-2.5" : "pl-2.5 pr-[60px]",
          unit && (hideSteppers ? "pr-12" : "pr-[100px]"),
        )}
      />
      {unit ? (
        <span
          className={cn(
            "num pointer-events-none absolute top-1/2 -translate-y-1/2 text-sm text-fg-secondary",
            hideSteppers ? "right-2.5" : "right-[64px]",
          )}
        >
          {unit}
        </span>
      ) : null}
      {!hideSteppers ? (
        <div className="absolute inset-y-px right-px flex overflow-hidden rounded-r-[5px] border-l border-hairline-strong">
          <button type="button" tabIndex={-1} className={stepBtn} aria-label="Decrease" disabled={disabled || (min !== undefined && (value ?? min) <= min)} onClick={() => nudge(-1)}>
            <Minus aria-hidden="true" />
          </button>
          <button type="button" tabIndex={-1} className={cn(stepBtn, "border-l border-hairline-strong")} aria-label="Increase" disabled={disabled || (max !== undefined && (value ?? 0) >= max)} onClick={() => nudge(1)}>
            <Plus aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
