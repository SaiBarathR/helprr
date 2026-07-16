'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { RecItem } from '@/lib/recommendations/rec-types';

// Client-side event beacon for the learning pipeline. Events queue locally and
// flush in batches (size- or timer-triggered; sendBeacon on pagehide so the
// tail of a session isn't lost). Impressions dedupe per itemKey per mount so
// scrolling a rail back and forth doesn't spam the log.

export type RecEventMode = 'rails' | 'feed' | 'random';

interface QueuedEvent {
  itemKey: string;
  eventType: string;
  railId?: string;
  context?: { position?: number; mode?: RecEventMode; genres?: string[]; exploration?: boolean };
}

const FLUSH_INTERVAL_MS = 4000;
const FLUSH_AT = 25;
const MAX_BATCH = 50;

export interface RecEventTracker {
  impression: (item: RecItem, railId: string, position: number, mode: RecEventMode) => void;
  event: (
    type: 'click' | 'like' | 'dislike' | 'not_interested' | 'watchlist_add' | 'request' | 'play',
    item: RecItem,
    railId: string,
    mode: RecEventMode
  ) => void;
  /** Force a flush now (after explicit feedback, before query invalidation). */
  flush: () => Promise<void>;
}

export function useRecEvents(): RecEventTracker {
  const queue = useRef<QueuedEvent[]>([]);
  const seenImpressions = useRef<Set<string>>(new Set());
  const flushing = useRef(false);

  const flush = useCallback(async () => {
    if (flushing.current || queue.current.length === 0) return;
    flushing.current = true;
    const batch = queue.current.splice(0, MAX_BATCH);
    try {
      await fetch('/api/recommendations/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      });
    } catch {
      // Lost telemetry is acceptable; never disturb the page for it.
    } finally {
      flushing.current = false;
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    const onPageHide = () => {
      if (queue.current.length === 0) return;
      const batch = queue.current.splice(0, MAX_BATCH);
      try {
        navigator.sendBeacon(
          '/api/recommendations/events',
          new Blob([JSON.stringify({ events: batch })], { type: 'application/json' })
        );
      } catch {
        // best-effort
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearInterval(interval);
      window.removeEventListener('pagehide', onPageHide);
      void flush();
    };
  }, [flush]);

  const push = useCallback((event: QueuedEvent) => {
    queue.current.push(event);
    if (queue.current.length >= FLUSH_AT) void flush();
  }, [flush]);

  const impression = useCallback<RecEventTracker['impression']>((item, railId, position, mode) => {
    const dedupeKey = `${railId}:${item.itemKey}`;
    if (seenImpressions.current.has(dedupeKey)) return;
    seenImpressions.current.add(dedupeKey);
    push({
      itemKey: item.itemKey,
      eventType: 'impression',
      railId,
      context: {
        position,
        mode,
        genres: item.genres.slice(0, 5),
        ...(item.exploration ? { exploration: true } : {}),
      },
    });
  }, [push]);

  const event = useCallback<RecEventTracker['event']>((type, item, railId, mode) => {
    push({
      itemKey: item.itemKey,
      eventType: type,
      railId,
      context: {
        mode,
        genres: item.genres.slice(0, 5),
        ...(item.exploration ? { exploration: true } : {}),
      },
    });
  }, [push]);

  return { impression, event, flush };
}
