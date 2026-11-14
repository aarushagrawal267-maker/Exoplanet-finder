/**
 * `useSSE` — subscribe to a server-sent-events stream (job progress, training epochs, the job
 * tray feed) with automatic reconnection.
 *
 * The browser's EventSource retries transient network drops by itself, but gives up for good when
 * the server answers with an HTTP error or closes the stream (readyState CLOSED). This hook then
 * reconnects with capped exponential backoff (1 s, 2 s, 4 s … ≤ 30 s) until `maxRetries` is hit.
 * Event payloads are JSON-decoded when possible.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { buildUrl } from "./url";

export type SSEStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";

export interface UseSSEOptions {
  /** Handlers for named events (`event: progress` → `events.progress(data)`). */
  events?: Record<string, (data: unknown, ev: MessageEvent) => void>;
  /** Handler for unnamed (`message`) events. */
  onMessage?: (data: unknown, ev: MessageEvent) => void;
  /** Called when the connection opens (also after each successful reconnect). */
  onOpen?: () => void;
  /** Set false to disconnect without unmounting. Default true. */
  enabled?: boolean;
  /** Maximum consecutive reconnect attempts (default 10). */
  maxRetries?: number;
  /** First backoff delay in ms (default 1000); doubles each attempt up to `maxDelayMs`. */
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Stop listening (and do not reconnect) after receiving this event name, e.g. "done". */
  closeOn?: string;
}

export interface UseSSEResult {
  status: SSEStatus;
  /** Consecutive failed attempts since the last successful open. */
  retries: number;
  /** Epoch ms of the last received event. */
  lastEventAt: number | null;
  close: () => void;
  reconnect: () => void;
}

function decode(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Subscribe to `path` (relative to the API base, or absolute). Pass `null` to stay idle. */
export function useSSE(path: string | null, options: UseSSEOptions = {}): UseSSEResult {
  const { enabled = true, maxRetries = 10, initialDelayMs = 1000, maxDelayMs = 30_000, closeOn } = options;
  const [status, setStatus] = useState<SSEStatus>("idle");
  const [retries, setRetries] = useState(0);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [epoch, setEpoch] = useState(0); // bump to force a fresh connection

  // Keep the latest handlers without re-opening the stream when callers pass new closures.
  const optsRef = useRef(options);
  optsRef.current = options;
  const sourceRef = useRef<EventSource | null>(null);
  const timerRef = useRef<number | null>(null);
  const manualCloseRef = useRef(false);
  const eventNames = Object.keys(options.events ?? {}).sort().join("|");

  const teardown = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => {
    if (!path || !enabled || typeof EventSource === "undefined") {
      setStatus("idle");
      return undefined;
    }
    manualCloseRef.current = false;
    let attempt = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      const es = new EventSource(buildUrl(path));
      sourceRef.current = es;

      const deliver = (name: string | null) => (ev: MessageEvent) => {
        setLastEventAt(Date.now());
        const data = decode(typeof ev.data === "string" ? ev.data : "");
        if (name === null) optsRef.current.onMessage?.(data, ev);
        else optsRef.current.events?.[name]?.(data, ev);
        if (closeOn && name === closeOn) {
          manualCloseRef.current = true;
          es.close();
          setStatus("closed");
        }
      };

      es.onopen = () => {
        attempt = 0;
        setRetries(0);
        setStatus("open");
        optsRef.current.onOpen?.();
      };
      es.onmessage = deliver(null);
      for (const name of eventNames ? eventNames.split("|") : []) {
        es.addEventListener(name, deliver(name) as EventListener);
      }
      es.onerror = () => {
        if (disposed || manualCloseRef.current) return;
        if (es.readyState === EventSource.CONNECTING) {
          // The browser is retrying on its own.
          setStatus("reconnecting");
          return;
        }
        es.close();
        if (attempt >= maxRetries) {
          setStatus("error");
          return;
        }
        const delay = Math.min(maxDelayMs, initialDelayMs * 2 ** attempt);
        attempt += 1;
        setRetries(attempt);
        setStatus("reconnecting");
        timerRef.current = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      teardown();
    };
  }, [path, enabled, maxRetries, initialDelayMs, maxDelayMs, closeOn, eventNames, epoch, teardown]);

  const close = useCallback(() => {
    manualCloseRef.current = true;
    teardown();
    setStatus("closed");
  }, [teardown]);

  const reconnect = useCallback(() => {
    teardown();
    setRetries(0);
    setEpoch((e) => e + 1);
  }, [teardown]);

  return { status, retries, lastEventAt, close, reconnect };
}
