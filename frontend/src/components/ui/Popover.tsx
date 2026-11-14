import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useOnClickOutside } from "@/lib/hooks";

export interface PopoverTriggerProps {
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-haspopup": "dialog";
  onClick: () => void;
  ref: (el: HTMLButtonElement | null) => void;
}

export interface PopoverProps {
  /** Render the trigger button; spread the provided props onto it. */
  trigger: (props: PopoverTriggerProps, open: boolean) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  width?: number;
  /** Accessible name of the popover panel. */
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * Non-modal popover anchored under its trigger. Closes on outside click and Escape (returning
 * focus to the trigger).
 */
export function Popover({ trigger, children, align = "end", width = 360, label, open: openProp, onOpenChange, className }: PopoverProps) {
  const id = useId();
  const [inner, setInner] = useState(false);
  const open = openProp ?? inner;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const refs = useRef([wrapperRef]).current;

  const setOpen = useCallback(
    (v: boolean) => {
      if (openProp === undefined) setInner(v);
      onOpenChange?.(v);
    },
    [openProp, onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);

  useOnClickOutside(refs, close, open);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <div ref={wrapperRef} className="relative">
      {trigger(
        {
          "aria-expanded": open,
          "aria-controls": id,
          "aria-haspopup": "dialog",
          onClick: () => setOpen(!open),
          ref: (el) => {
            triggerRef.current = el;
          },
        },
        open,
      )}
      {open ? (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={label}
          style={{ width: `min(${width}px, calc(100vw - 24px))` }}
          className={cn(
            "card-surface absolute top-full z-40 mt-2 animate-rise-in bg-surface-raised p-0 shadow-[0_16px_48px_-12px_rgb(0_0_0/0.7)]",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}
