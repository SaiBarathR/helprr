const MIN_REFRESH_SECS = 2;

export type RefreshSettingKey =
  | 'dashboardRefreshIntervalSecs'
  | 'activityRefreshIntervalSecs'
  | 'torrentsRefreshIntervalSecs';

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
