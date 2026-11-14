import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./Field";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label rendered next to the switch (omit when used inside <Field>). */
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  size?: "sm" | "md";
  id?: string;
  "aria-label"?: string;
  className?: string;
}

/** On/off toggle (role="switch"). The track's off-state border meets 3:1 non-text contrast. */
export function Switch({ checked, onChange, label, description, disabled, size = "md", className, ...rest }: SwitchProps) {
  const field = useFieldControl(rest);
  const track = size === "sm" ? "h-4 w-7" : "h-5 w-9";
  const thumb = size === "sm" ? "size-3" : "size-3.5";
  const shift = size === "sm" ? "translate-x-3" : "translate-x-4";
  const button = (
    <button
      type="button"
      role="switch"
      id={field.id}
      aria-checked={checked}
      aria-label={rest["aria-label"]}
      aria-describedby={field["aria-describedby"]}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-fast disabled:opacity-45",
        track,
        checked ? "border-cosmic bg-cosmic" : "border-fg-muted bg-void",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-[2px] rounded-full transition-transform duration-fast ease-out",
          thumb,
          checked ? cn(shift, "bg-void") : "translate-x-0 bg-fg-secondary",
        )}
      />
    </button>
  );
  if (!label) return <span className={className}>{button}</span>;
  return (
    <label className={cn("flex cursor-pointer items-start gap-3", disabled && "cursor-not-allowed", className)}>
      <span className="mt-0.5">{button}</span>
      <span className="flex flex-col">
        <span className="text-base text-fg">{label}</span>
        {description ? <span className="text-xs text-fg-secondary">{description}</span> : null}
      </span>
    </label>
  );
}
