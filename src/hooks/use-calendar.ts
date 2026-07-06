import { useState, useEffect, useCallback, useRef } from 'react';
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
  refetch: () => void;
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

  const fetchEvents = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    setLoading(true);
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

      const res = await fetch(`/api/calendar?${params.toString()}`, { signal });

      if (!res.ok) {
        throw new Error('Failed to fetch calendar events');
      }

      const data: CalendarEvent[] = await res.json();
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
    void fetchEvents();
    return () => abortRef.current?.abort();
  }, [fetchEvents]);

  const refetch = useCallback(() => {
    void fetchEvents();
  }, [fetchEvents]);

  return { events, loading, error, refetch };
}
