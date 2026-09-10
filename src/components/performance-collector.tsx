'use client';

import { useEffect } from 'react';

// Explicit local opt-in. Never sent to the logger, an API, or analytics.
const KEY = 'helprr:measure-performance';
const LIMIT = 2_000;
type Sample = { kind: string; at: number; duration?: number; bytes?: number; count?: number };

export function PerformanceCollector() {
  useEffect(() => {
    try { if (localStorage.getItem(KEY) !== '1') return; } catch { return; }
    const samples: Sample[] = [];
    const record = (sample: Sample) => { samples.push(sample); if (samples.length > LIMIT) samples.shift(); };
    const target = window as typeof window & { helprrPerformance?: { samples: Sample[]; clear: () => void } };
    target.helprrPerformance = { samples, clear: () => { samples.length = 0; } };
    const observers: PerformanceObserver[] = [];
    for (const type of ['navigation', 'resource', 'paint', 'largest-contentful-paint', 'longtask', 'event']) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // Never retain resource URLs, query strings, DOM text, titles or IDs.
          const resource = entry as PerformanceResourceTiming;
          record({ kind: type, at: entry.startTime, duration: entry.duration,
            ...(type === 'resource' ? { bytes: resource.transferSize } : {}) });
        }
      });
      observer.observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
      observers.push(observer);
    }
    const onAction = () => {
      const at = performance.now();
      record({ kind: 'action', at });
      requestAnimationFrame(() => requestAnimationFrame(() => record({ kind: 'action-frame', at, duration: performance.now() - at })));
    };
    const onMark = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      if (detail === 'play-preparing' || detail === 'stop-local' || detail === 'content-ready') record({ kind: detail, at: performance.now() });
    };
    const timer = setInterval(() => record({ kind: 'mounted-cards', at: performance.now(), count: document.querySelectorAll('[data-rail-slot] > *, [data-index]').length }), 2_000);
    window.addEventListener('pointerdown', onAction, { passive: true });
    window.addEventListener('helprr-performance', onMark);
    return () => {
      observers.forEach((observer) => observer.disconnect());
      clearInterval(timer);
      window.removeEventListener('pointerdown', onAction);
      window.removeEventListener('helprr-performance', onMark);
      delete target.helprrPerformance;
    };
  }, []);
  return null;
}
