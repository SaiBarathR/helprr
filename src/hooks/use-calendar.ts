import { useState, useEffect, useCallback, useRef } from 'react';
import { recordBrowseFreshness } from '@/lib/browse-freshness';
import type { CalendarEvent } from '@/types';

interface UseCalendarParams {
  start: Date;
  end: Date;
  type?: string;
  includeScheduled?: boolean;
}

interface UseCalendarReturn {
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  /** Reloads the current range without flagging `loading`, so the views stay up. */
  refetch: () => Promise<void>;
}

export function useCalendar({ start, end, type, includeScheduled }: UseCalendarParams): UseCalendarReturn {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startISO = start.toISOString();
  const endISO = end.toISOString();

  // One controller for both the effect fetch and manual refetch, so whichever
  // request is newest supersedes the in-flight one (a stale month can't win).
  const abortRef = useRef<AbortController | null>(null);

  const fetchEvents = useCallback(async (background = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    if (!background) setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        start: startISO,
        end: endISO,
      });

      if (type && type !== 'all') {
        params.set('type', type);
      }
      if (includeScheduled) {
        params.set('includeScheduled', 'true');
      }

      const path = `/api/calendar?${params.toString()}`;
      const res = await fetch(path, { signal });
      // An offline snapshot from the worker shows the shared "saved data" notice, as library pages do.
      recordBrowseFreshness(path, res);

      if (!res.ok) {
        throw new Error('Failed to fetch calendar events');
      }

      const data: CalendarEvent[] = await res.json();
      if (signal.aborted) return; // superseded while the body was streaming
      setEvents(data);
    } catch (err) {
      // Aborted = superseded by a newer range/type; that request owns the state now.
      if (signal.aborted) return;
      setError(err instanceof Error ? err.message : 'An error occurred');
      setEvents([]);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [startISO, endISO, type, includeScheduled]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start the abortable calendar load whenever the requested range or type changes
    void fetchEvents();
    return () => abortRef.current?.abort();
  }, [fetchEvents]);

  const refetch = useCallback(() => fetchEvents(true), [fetchEvents]);

  return { events, loading, error, refetch };
}
