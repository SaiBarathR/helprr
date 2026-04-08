'use client';

import { useEffect } from 'react';
import { setHideExternalImages } from '@/lib/image';

export function HideImagesProvider() {
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok || cancelled) return;
        const settings = await res.json();
        if (!cancelled && typeof settings.hideImagesEnabled === 'boolean') {
          setHideExternalImages(settings.hideImagesEnabled);
        }
      } catch {
        // Settings may not exist yet
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
