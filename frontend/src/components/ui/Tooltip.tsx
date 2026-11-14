import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "@/lib/cn";
import { Portal } from "./overlay";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element (button, link…). It receives aria-describedby. */
  children: ReactElement;
  side?: TooltipSide;
  delayMs?: number;
  disabled?: boolean;
  className?: string;
}

type Handlers = {
  onMouseEnter?: (e: unknown) => void;
  onMouseLeave?: (e: unknown) => void;
  onFocus?: (e: unknown) => void;
  onBlur?: (e: unknown) => void;
  "aria-describedby"?: string;
};

const GAP = 8;

/**
 * Hover / focus tooltip rendered in a portal and kept inside the viewport (flips to the opposite
 * side when there is no room). Esc dismisses it. Supplementary text only — never put essential
 * information or interactive content in a tooltip.
 */
export function Tooltip({ content, children, side = "top", delayMs = 250, disabled = false, className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; side: TooltipSide } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  const show = useCallback(() => {
    if (disabled) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delayMs);
  }, [delayMs, disabled]);
  const hide = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  }, []);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open, hide]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const t = tipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let s = side;
    if (s === "top" && a.top - t.height - GAP < 4) s = "bottom";
    else if (s === "bottom" && a.bottom + t.height + GAP > vh - 4) s = "top";
    else if (s === "left" && a.left - t.width - GAP < 4) s = "right";
    else if (s === "right" && a.right + t.width + GAP > vw - 4) s = "left";
    let top = 0;
    let left = 0;
    if (s === "top" || s === "bottom") {
      top = s === "top" ? a.top - t.height - GAP : a.bottom + GAP;
      left = a.left + a.width / 2 - t.width / 2;
    } else {
      top = a.top + a.height / 2 - t.height / 2;
      left = s === "left" ? a.left - t.width - GAP : a.right + GAP;
    }
    left = Math.max(4, Math.min(left, vw - t.width - 4));
    top = Math.max(4, Math.min(top, vh - t.height - 4));
    setPos({ top, left, side: s });
  }, [open, side, content]);

  if (!isValidElement(children)) return children;
  const child = children as ReactElement<Handlers & { ref?: unknown }>;
  const props = child.props;

  // Preserve a ref the caller already put on the child (React 18 keeps it on the element).
  const originalRef = (children as unknown as { ref?: Ref<HTMLElement> }).ref;
  const trigger = cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      if (typeof originalRef === "function") originalRef(node);
      else if (originalRef && typeof originalRef === "object") (originalRef as MutableRefObject<HTMLElement | null>).current = node;
    },
    onMouseEnter: (e: unknown) => {
      props.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: unknown) => {
      props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: unknown) => {
      props.onFocus?.(e);
      show();
    },
    onBlur: (e: unknown) => {
      props.onBlur?.(e);
      hide();
    },
    "aria-describedby": [props["aria-describedby"], open ? id : undefined].filter(Boolean).join(" ") || undefined,
  } as Handlers);

  return (
    <>
      {trigger}
      {open ? (
        <Portal>
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className={cn(
              "pointer-events-none fixed z-[60] max-w-xs animate-fade-in rounded-md border border-hairline-strong bg-surface-raised px-2.5 py-1.5 text-xs text-fg shadow-[0_8px_24px_-6px_rgb(0_0_0/0.6)]",
              className,
            )}
          >
            {content}
          </div>
        </Portal>
      ) : null}
    </>
  );
}
