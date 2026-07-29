'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type RegisterDataDemand = (token: symbol) => () => void;

export function useDataDemandRegistry(): {
  hasDemand: boolean;
  registerDemand: RegisterDataDemand;
} {
  const tokens = useRef(new Set<symbol>());
  const [hasDemand, setHasDemand] = useState(false);

  const registerDemand = useCallback<RegisterDataDemand>((token) => {
    const added = !tokens.current.has(token);
    if (added) {
      tokens.current.add(token);
      if (tokens.current.size === 1) setHasDemand(true);
    }

    let active = true;
    return () => {
      if (!active || !added) return;
      active = false;
      tokens.current.delete(token);
      if (tokens.current.size === 0) setHasDemand(false);
    };
  }, []);

  return { hasDemand, registerDemand };
}

export function useDataDemand(
  registerDemand: RegisterDataDemand,
  enabled: boolean,
): void {
  const token = useRef<symbol | null>(null);
  token.current ??= Symbol('data-demand');

  useEffect(() => {
    if (!enabled) return;
    return registerDemand(token.current!);
  }, [enabled, registerDemand]);
}
