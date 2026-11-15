import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A short pause after an action, so a button cannot be pressed again and again.
 * start() begins the pause; `remainingSec` counts down and `active` is true until it ends.
 */
export function useCooldown(ms: number) {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const untilRef = useRef(0);

  useEffect(() => {
    if (until <= Date.now()) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= until) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [until]);

  const start = useCallback(() => {
    const end = Date.now() + ms;
    untilRef.current = end;
    setNow(Date.now());
    setUntil(end);
  }, [ms]);

  /** Reads the clock itself, so it is right even inside an event handler that runs between renders. */
  const isActive = useCallback(() => Date.now() < untilRef.current, []);

  const remainingMs = Math.max(0, until - now);
  return { start, isActive, active: remainingMs > 0, remainingSec: Math.ceil(remainingMs / 1000) };
}
