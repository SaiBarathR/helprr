const MIN_REFRESH_SECS = 2;

export type RefreshSettingKey =
  | 'dashboardRefreshIntervalSecs'
  | 'activityRefreshIntervalSecs'
  | 'torrentsRefreshIntervalSecs';

/**
 * Retrieve the refresh interval in milliseconds for the given setting key.
 *
 * @param key - The refresh setting to read: 'dashboardRefreshIntervalSecs', 'activityRefreshIntervalSecs', or 'torrentsRefreshIntervalSecs'
 * @param fallbackSecs - Seconds to use if the setting is missing, invalid, or the fetch fails (defaults to 5)
 * @returns The refresh interval in milliseconds; if the stored value is a finite number the minimum of that value and `MIN_REFRESH_SECS` is enforced, otherwise `fallbackSecs` is used
 */
export async function getRefreshIntervalMs(
  key: RefreshSettingKey,
  fallbackSecs = 5,
): Promise<number> {
  try {
    const res = await fetch('/api/settings', { cache: 'no-store' });
    if (!res.ok) return fallbackSecs * 1000;
    const settings = await res.json();
    const raw = Number(settings?.[key]);
    const secs = Number.isFinite(raw) ? Math.max(MIN_REFRESH_SECS, raw) : fallbackSecs;
    return secs * 1000;
  } catch {
    return fallbackSecs * 1000;
  }
}