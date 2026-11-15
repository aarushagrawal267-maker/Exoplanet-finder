import { X } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Portal, useDialogBehaviour } from "./overlay";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Accessible name when no visible title is rendered. */
  "aria-label"?: string;
  description?: ReactNode;
  side?: "left" | "right";
  width?: number;
  children?: ReactNode;
  footer?: ReactNode;
  /** Remove default body padding (e.g. for navigation). */
  bare?: boolean;
  className?: string;
}

/** Edge-anchored dialog panel (details, filters, and the mobile navigation). */
export function Drawer({ open, onClose, title, description, side = "right", width = 420, children, footer, bare = false, className, ...aria }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogBehaviour(ref, open, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0 animate-fade-in bg-void/70 backdrop-blur-[2px]" aria-hidden="true" onClick={onClose} />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : aria["aria-label"]}
          tabIndex={-1}
          style={{ width: `min(${width}px, 100vw - 48px)` }}
          className={cn(
            "absolute inset-y-0 flex flex-col border-hairline bg-space shadow-[0_0_64px_-8px_rgb(0_0_0/0.7)]",
            side === "right" ? "right-0 animate-slide-in-right border-l" : "left-0 animate-slide-in-left border-r",
            className,
          )}
        >
          {title ? (
            <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-md font-semibold text-fg">
                  {title}
                </h2>
                {description ? <p className="mt-1 text-sm text-fg-secondary">{description}</p> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close panel"
                className="-mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-md text-fg-secondary hover:bg-fg/[0.06] hover:text-fg"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <div className={cn("min-h-0 flex-1 overflow-y-auto", !bare && "px-5 py-4")}>{children}</div>
          {footer ? <div className="flex items-center justify-end gap-2 border-t border-hairline px-5 py-3">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}
