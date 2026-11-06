'use client';

import { setDateTimePrefs, type DateTimePrefs } from '@/lib/date-format';

let lastSeed: string | null = null;

// Seeds the client's date/time format preference from the server-read
// UserSettings. Rendered ahead of the page in the (app) layout so dates format
// correctly on the first client render. Applies only when the seed itself
// changes: the layout persists across navigations, so a stale seed must not undo
// a change made on the Preferences page. Silent (no re-render of subscribers)
// because it runs during render.
export function DateFormatInit({ value }: { value: DateTimePrefs }) {
  const key = `${value.timeFormat}|${value.dateFormat}`;
  if (typeof window !== 'undefined' && key !== lastSeed) {
    lastSeed = key;
    setDateTimePrefs(value, { notify: false });
  }
  return null;
}
