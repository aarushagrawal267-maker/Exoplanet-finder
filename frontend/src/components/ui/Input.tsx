import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./Field";

/**
 * Shared look for text-like controls. Borders use text-muted (#5F6B8A, ≥3:1 against surfaces) so
 * the control boundary meets WCAG 1.4.11 non-text contrast.
 */
export const controlClasses =
  "w-full rounded-md border border-fg-muted/80 bg-void/60 text-fg placeholder:text-fg-muted " +
  "transition-[border-color,box-shadow] duration-fast hover:border-fg-secondary/70 " +
  "focus-visible:border-cosmic focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cosmic/35 " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/30 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "sm" | "md";
  /** Leading adornment (icon). */
  leading?: ReactNode;
  /** Trailing adornment (unit, button). */
  trailing?: ReactNode;
  /** Render the value in mono (IDs, numbers). */
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = "md", leading, trailing, mono, className, ...rest },
  ref,
) {
  const field = useFieldControl(rest);
  return (
    <div className={cn("relative flex items-center", className)}>
      {leading ? (
        <span className="pointer-events-none absolute left-2.5 flex text-fg-secondary [&_svg]:size-4">{leading}</span>
      ) : null}
      <input
        ref={ref}
        {...rest}
        id={field.id}
        aria-describedby={field["aria-describedby"]}
        aria-invalid={field["aria-invalid"]}
        required={rest.required ?? (field.required || undefined)}
        className={cn(
          controlClasses,
          size === "sm" ? "h-8 px-2.5 text-sm" : "h-9 px-3 text-base",
          leading ? (size === "sm" ? "pl-8" : "pl-9") : undefined,
          trailing ? "pr-10" : undefined,
          mono && "num",
        )}
      />
      {trailing ? <span className="absolute right-2.5 flex items-center text-sm text-fg-secondary">{trailing}</span> : null}
    </div>
  );
});
