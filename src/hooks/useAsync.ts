import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { errMsg } from '../lib/format';

export interface AsyncState<T> { data: T | null; error: string | null; loading: boolean; reload(): void }

/** Loads data, reloads on demand, and (optionally) whenever the backend reports changes. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], live = false): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn); fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setLoading((l) => l || data === null);
    fnRef.current().then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(errMsg(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = api.subscribe(() => { clearTimeout(timer); timer = setTimeout(() => setTick((t) => t + 1), 250); });
    return () => { clearTimeout(timer); off(); };
  }, [live]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
