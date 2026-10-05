import { useEffect, useState } from 'react';

/** Re-renders on an interval while `active`. Returns the local `Date.now()` at the last tick. Display only. */
export function useNow(active: boolean, intervalMs = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

/** Whole seconds left until a server-clock instant, never negative. Display only; the server enforces deadlines. */
export function secondsLeft(targetServerMs: number | null, localNow: number, offsetMs: number): number {
  if (targetServerMs === null) return 0;
  return Math.max(0, Math.ceil((targetServerMs - (localNow + offsetMs)) / 1000));
}

export function fractionLeft(
  startServerMs: number | null,
  targetServerMs: number | null,
  localNow: number,
  offsetMs: number,
): number {
  if (startServerMs === null || targetServerMs === null || targetServerMs <= startServerMs) return 0;
  const left = targetServerMs - (localNow + offsetMs);
  return Math.min(1, Math.max(0, left / (targetServerMs - startServerMs)));
}
