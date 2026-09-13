"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export interface ResourceState<T> {
  data: T | null;
  error: unknown;
  /** True only until the first load settles; background refreshes never flip it. */
  loading: boolean;
  refresh: () => Promise<T | null>;
}

/**
 * Loads `loader()` once on mount and whenever the (memoized) loader identity changes.
 * `refresh()` re-runs it in the background; stale responses are dropped.
 */
export function useResource<T>(loader: () => Promise<T>): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const refresh = useCallback((): Promise<T | null> => {
    const ticket = ++seq.current;
    // State is only ever set from the promise callbacks (never synchronously), so the
    // mount effect below does not cascade renders.
    return Promise.resolve()
      .then(() => loader())
      .then(
        (next) => {
          if (ticket !== seq.current) return null;
          setData(next);
          setError(null);
          setLoading(false);
          return next;
        },
        (err: unknown) => {
          if (ticket !== seq.current) return null;
          setError(err);
          setLoading(false);
          return null;
        },
      );
  }, [loader]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, error, loading, refresh };
}

/** setInterval with the latest callback; pass `null` to pause. */
export function useInterval(callback: () => void, delayMs: number | null): void {
  const saved = useRef(callback);

  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delayMs === null) return;
    const id = setInterval(() => saved.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}

// A shared one-second clock so relative times and countdowns re-render without each
// component owning a timer. Snapshot is rounded to the second to stay stable per tick.
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockTimer === null) {
    clockTimer = setInterval(() => {
      for (const fn of clockListeners) fn();
    }, 1000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

function clockSnapshot(): number {
  return Math.floor(Date.now() / 1000) * 1000;
}

function clockServerSnapshot(): number {
  return 0;
}

/** Current time in ms, ticking once per second. Returns 0 during server render / hydration. */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, clockSnapshot, clockServerSnapshot);
}

/** Tracks an async action per key (e.g. one busy flag per draft) and surfaces its last error. */
export function useAsyncAction() {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const run = useCallback(async (key: string, fn: () => Promise<void>): Promise<boolean> => {
    setBusyKey(key);
    setActionError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setActionError(err);
      return false;
    } finally {
      setBusyKey(null);
    }
  }, []);

  const clearError = useCallback(() => setActionError(null), []);

  return { busyKey, actionError, run, clearError };
}
