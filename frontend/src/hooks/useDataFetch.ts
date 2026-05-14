import { useState, useCallback, useEffect } from 'react';

/**
 * Fetch a list on mount and expose a reload function.
 * Pass a stable function reference (module-level or memoised) to avoid
 * triggering repeated fetches.
 */
export function useDataFetch<T>(fetcher: () => Promise<T[]>) {
  const [data,    setData]    = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await fetcher()); }
    finally { setLoading(false); }
  }, [fetcher]);

  useEffect(() => { reload(); }, [reload]);

  return { data, loading, reload };
}
