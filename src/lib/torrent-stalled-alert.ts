// How long a download must stay stalled, or stuck on its metadata, before the
// "Torrent Stalled" push (AppSettings.torrentStalledAlertMins). Dependency-free
// so the settings page, API, import and poller share it.
export const DEFAULT_TORRENT_STALLED_ALERT_MINS = 30;
export const MIN_TORRENT_STALLED_ALERT_MINS = 5;
export const MAX_TORRENT_STALLED_ALERT_MINS = 1440;
export const TORRENT_STALLED_ALERT_OPTIONS = [5, 10, 15, 30, 60, 120, 360, 720, 1440] as const;

/** "30 min", "1 h", "1.5 h". */
export function formatStalledFor(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${Math.round((minutes / 60) * 10) / 10} h`;
}
