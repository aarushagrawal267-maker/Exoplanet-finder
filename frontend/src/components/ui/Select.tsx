import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./Field";
import { controlClasses } from "./Input";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size" | "onChange"> {
  options: ReadonlyArray<SelectOption>;
  onChange?: (value: string) => void;
  size?: "sm" | "md";
  /** Optional non-selectable first option, e.g. "Choose a model…". */
  placeholder?: string;
  mono?: boolean;
}

/**
 * Styled native <select>: keyboard, screen-reader and mobile behaviour come from the platform.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, onChange, size = "md", placeholder, mono, className, value, ...rest },
  ref,
) {
  const field = useFieldControl(rest);
  return (
    <div className={cn("relative", className)}>
      <select
        ref={ref}
        {...rest}
        value={value}
        id={field.id}
        aria-describedby={field["aria-describedby"]}
        aria-invalid={field["aria-invalid"]}
        onChange={(e) => onChange?.(e.target.value)}
        className={cn(
          controlClasses,
          "appearance-none truncate pr-9",
          size === "sm" ? "h-8 pl-2.5 text-sm" : "h-9 pl-3 text-base",
          mono && "num",
          "[&>option]:bg-surface-raised [&>option]:text-fg",
        )}
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-secondary" aria-hidden="true" />
    </div>
  );
});
