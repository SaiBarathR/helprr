'use client';

import { useSyncExternalStore } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiError } from '@/lib/query-fetch';
import {
  DEFAULT_DATE_TIME_PREFS,
  formatDateTime,
  getDateTimePrefs,
  parseDateFormat,
  parseTimeFormat,
  setDateTimePrefs,
  subscribeDateTimePrefs,
  type DateTimePrefs,
} from '@/lib/date-format';

const TRIGGER_CLASS = 'w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring [&>svg]:h-3.5 [&>svg]:w-3.5';

const TIME_OPTIONS = [
  { value: 'auto', label: 'Automatic' },
  { value: '12h', label: '12-hour (8:26 PM)' },
  { value: '24h', label: '24-hour (20:26)' },
];

const DATE_OPTIONS = [
  { value: 'auto', label: 'Automatic' },
  { value: 'dmy', label: '7 Nov 2026' },
  { value: 'mdy', label: 'Nov 7, 2026' },
  { value: 'iso', label: '2026-11-07' },
];

// An evening time so the 12/24-hour difference shows.
const SAMPLE = new Date(2026, 10, 7, 20, 26);

const noopSubscribe = () => () => {};

/** Per-user date and time display format, saved to the account. */
export function DateTimeFormatSection() {
  // 'auto' during SSR and hydration, then the seeded preference.
  const prefs = useSyncExternalStore(subscribeDateTimePrefs, getDateTimePrefs, () => DEFAULT_DATE_TIME_PREFS);
  // 'Automatic' follows the browser locale, which the server can't know, so the
  // preview renders only on the client.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const save = useMutation({
    // Same scope as the quiet-hours writes to /api/me/settings, so they apply in order.
    scope: { id: 'me-settings' },
    mutationFn: async (patch: Partial<DateTimePrefs>) => {
      const res = await fetch('/api/me/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      // ApiError (carrying status) so a 401 hits the global MutationCache redirect.
      if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
    },
    // Applied at once; the server stores exactly what was sent, so success needs no echo.
    onMutate: (patch) => {
      const previous = getDateTimePrefs();
      setDateTimePrefs({ ...previous, ...patch });
      return { previous };
    },
    onError: (_err, _patch, context) => {
      toast.error('Failed to save the date and time format');
      if (context) setDateTimePrefs(context.previous);
    },
  });

  return (
    <GroupedSection title="Date & Time" footer="Saved to your account">
      <div className="grouped-row">
        <span className="text-sm">Time format</span>
        <Select
          value={prefs.timeFormat}
          onValueChange={(v) => save.mutate({ timeFormat: parseTimeFormat(v) })}
        >
          <SelectTrigger aria-label="Time format" className={TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grouped-row">
        <span className="text-sm">Date format</span>
        <Select
          value={prefs.dateFormat}
          onValueChange={(v) => save.mutate({ dateFormat: parseDateFormat(v) })}
        >
          <SelectTrigger aria-label="Date format" className={TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grouped-row">
        <span className="text-sm">Preview</span>
        <span className="text-sm text-muted-foreground tabular-nums" data-testid="date-time-preview">
          {mounted ? formatDateTime(SAMPLE, undefined, prefs) : ''}
        </span>
      </div>
    </GroupedSection>
  );
}
