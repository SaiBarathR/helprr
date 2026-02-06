import { useState, useEffect, useCallback } from 'react';
import type { CalendarEvent } from '@/types';

interface UseCalendarParams {
  start: Date;
  end: Date;
  type?: string;
}

interface UseCalendarReturn {
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useCalendar({ start, end, type }: UseCalendarParams): UseCalendarReturn {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const fetchEvents = useCallback(async () => {
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

      const res = await fetch(`/api/calendar?${params.toString()}`);

      if (!res.ok) {
        throw new Error('Failed to fetch calendar events');
      }

      const data: CalendarEvent[] = await res.json();
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [startISO, endISO, type]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return { events, loading, error, refetch: fetchEvents };
}
