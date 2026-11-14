import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "model" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium " +
  "transition-[background-color,border-color,color,box-shadow] duration-fast ease-out " +
  "disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0";

const variants: Record<ButtonVariant, string> = {
  // Cosmic blue fill with void text: 7.5:1 contrast.
  primary: "bg-cosmic text-void hover:bg-[#86ADFF] active:bg-[#5D8BF0] shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]",
  secondary: "border border-hairline-strong bg-surface-raised text-fg hover:border-fg-muted hover:bg-[#1A2340]",
  ghost: "text-fg-secondary hover:bg-fg/[0.06] hover:text-fg",
  outline: "border border-cosmic/50 text-cosmic hover:border-cosmic hover:bg-cosmic/10",
  // Model / AI actions use nebula violet.
  model: "border border-nebula/50 bg-nebula/10 text-nebula hover:border-nebula hover:bg-nebula/15",
  danger: "border border-danger/45 bg-danger/10 text-danger hover:border-danger hover:bg-danger/15",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm [&_svg]:size-3.5",
  md: "h-9 px-3.5 text-base [&_svg]:size-4",
  lg: "h-11 px-5 text-md [&_svg]:size-[18px]",
};

const iconOnlySizes: Record<ButtonSize, string> = {
  sm: "size-8 px-0",
  md: "size-9 px-0",
  lg: "size-11 px-0",
};

/** Class string for button-styled links (e.g. react-router `<Link>`). */
export function buttonClasses({
  variant = "secondary",
  size = "md",
  iconOnly = false,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; iconOnly?: boolean; className?: string } = {}): string {
  return cn(base, variants[variant], sizes[size], iconOnly && iconOnlySizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon element (e.g. `<Play />`). */
  icon?: ReactNode;
  /** Trailing icon element. */
  iconRight?: ReactNode;
  /** Square, icon-only button. Requires `aria-label`. */
  iconOnly?: boolean;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
}

/** The app's button. Defaults to `type="button"` so it never submits a form by accident. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, iconRight, iconOnly = false, loading = false, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses({ variant, size, iconOnly, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : icon}
      {iconOnly ? null : children}
      {!loading && iconRight}
    </button>
  );
});
