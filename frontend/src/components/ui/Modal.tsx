import { X } from "lucide-react";
import { useId, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { Portal, useDialogBehaviour } from "./overlay";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Element to focus first (defaults to the first focusable, or [data-autofocus]). */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Hide the close button (Esc and backdrop still close unless `dismissable` is false). */
  hideClose?: boolean;
  /** When false the backdrop click does not close (Esc still does). */
  dismissable?: boolean;
  className?: string;
}

const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" } as const;

/** Accessible modal dialog (role="dialog", aria-modal, focus trap, Esc to close). */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  initialFocus,
  hideClose = false,
  dismissable = true,
  className,
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useDialogBehaviour(ref, open, onClose, initialFocus);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
        <div
          className="absolute inset-0 animate-fade-in bg-void/75 backdrop-blur-[2px]"
          aria-hidden="true"
          onClick={dismissable ? onClose : undefined}
        />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          className={cn(
            "card-surface relative flex max-h-[90vh] w-full animate-rise-in flex-col bg-surface-raised shadow-[0_24px_64px_-12px_rgb(0_0_0/0.6)]",
            "rounded-b-none sm:rounded-card",
            widths[size],
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-md font-semibold text-fg">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="mt-1 text-sm text-fg-secondary">
                  {description}
                </p>
              ) : null}
            </div>
            {!hideClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="-mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-md text-fg-secondary hover:bg-fg/[0.06] hover:text-fg"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex items-center justify-end gap-2 border-t border-hairline px-5 py-3">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}
