'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/lib/store';
import { validateDiscoverLayout } from '@/lib/discover-layout-config';

export function DiscoverLayoutHydrator() {
  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/discover-layout')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const validated = validateDiscoverLayout(data);
        if (validated) {
          useUIStore.getState().setDiscoverLayout(validated);
        }
      })
      .catch(() => {
        // silent — keep cached layout
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
