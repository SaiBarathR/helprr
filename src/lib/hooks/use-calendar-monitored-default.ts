'use client';

import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';

// Where the Calendar page's "Monitored only" switch starts: saved to the
// account (UserSettings.calendarMonitoredOnly, /api/me/settings), so every
// device starts the same. Settings → Appearance → Calendar changes it.
export const CALENDAR_MONITORED_DEFAULT_KEY = ['me-calendar-monitored-default'] as const;

export interface CalendarMonitoredDefault {
  calendarMonitoredOnly: boolean;
}

/** The saved default (false until it loads, and when it cannot be read), and whether it is still loading. */
export function useCalendarMonitoredDefault() {
  const { data, isPending } = useQuery({
    queryKey: CALENDAR_MONITORED_DEFAULT_KEY,
    queryFn: jsonFetcher<CalendarMonitoredDefault>('/api/me/settings'),
    // The page holds its events back while this loads; don't stall it on retries.
    retry: 1,
  });
  return { monitoredOnly: data?.calendarMonitoredOnly === true, pending: isPending };
}
