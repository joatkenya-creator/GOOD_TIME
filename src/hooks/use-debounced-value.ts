'use client';

import { useEffect, useState } from 'react';

/**
 * Delays a rapidly-changing value. Used by the search box so typing does not
 * fire a query per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
