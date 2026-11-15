import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./Field";
import { NumberInput } from "./NumberInput";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Show the paired numeric input (default true). */
  showInput?: boolean;
  /** Format the value for assistive tech (aria-valuetext). */
  formatValue?: (v: number) => string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

/**
 * Range slider paired with a precise numeric input. The filled part of the track uses a CSS
 * custom property (--pct) so no JS layout work is needed.
 */
export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  showInput = true,
  formatValue,
  disabled,
  className,
  ...rest
}: SliderProps) {
  const field = useFieldControl(rest);
  const pct = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <input
        type="range"
        id={field.id}
        aria-label={rest["aria-label"]}
        aria-describedby={field["aria-describedby"]}
        aria-valuetext={formatValue ? formatValue(value) : undefined}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--pct": `${pct}%` } as CSSProperties}
        className="exo-range h-5 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-45"
      />
      {showInput ? (
        <NumberInput
          value={value}
          onChange={(v) => v !== null && onChange(v)}
          min={min}
          max={max}
          step={step}
          unit={unit}
          size="sm"
          hideSteppers
          disabled={disabled}
          aria-label={`${rest["aria-label"] ?? "Value"} (exact)`}
          className={unit ? "w-28" : "w-20"}
        />
      ) : null}
    </div>
  );
}
