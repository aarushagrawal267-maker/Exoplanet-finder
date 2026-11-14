/** Small, dependency-free React hooks shared across the UI. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/** Subscribe to a CSS media query. Returns `false` during SSR / when matchMedia is missing. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/**
 * True when motion should be minimised: the operating-system preference, unless the Settings page
 * forces it (`<html data-motion="reduce|full">`, see lib/uiPreferences.ts).
 */
export function usePrefersReducedMotion(): boolean {
  const os = useMediaQuery("(prefers-reduced-motion: reduce)");
  const forced = typeof document !== "undefined" ? document.documentElement.dataset.motion : undefined;
  if (forced === "reduce") return true;
  if (forced === "full") return false;
  return os;
}

/**
 * State persisted to localStorage (per browser). Storage failures (private mode, quota, disabled
 * storage) are swallowed: the value simply falls back to in-memory state.
 */
export function useLocalStorage<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable — keep in-memory value */
    }
  }, [key, value]);
  return [value, setValue];
}

/** Debounce a changing value. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Call `handler` on pointer-down outside every element in `refs` while `active`. */
export function useOnClickOutside(
  refs: ReadonlyArray<React.RefObject<HTMLElement | null>>,
  handler: () => void,
  active = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!active) return undefined;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (refs.some((r) => r.current?.contains(target))) return;
      handlerRef.current();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [refs, active]);
}

let idCounter = 0;
/** Stable unique id (React 18 has useId, but this variant is prefix-friendly for SVG defs). */
export function useStableId(prefix = "exo"): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) {
    idCounter += 1;
    ref.current = `${prefix}-${idCounter}`;
  }
  return ref.current;
}

/**
 * Width of an element in px, tracked with ResizeObserver (0 until measured / in jsdom). Lets a
 * component adapt to the space it is given rather than the viewport (a poor man's container query).
 */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(Math.round(w));
    });
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
