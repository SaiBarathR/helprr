import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { getLocalDateKey } from '@/lib/timezone';
import { clampWindowStart, eachDayKey, normalizeDateKey, shiftDayKey } from '@/lib/insights';
import { withApiLogging } from '@/lib/api-logger';

// Collect the local day-key of every item's `added` timestamp across instances.
// One unreachable instance is swallowed so it can't blank the whole curve.
async function collectAddedKeys<T>(
  instances: Array<{ client: T }>,
  getItems: (client: T) => Promise<Array<{ added?: string }>>,
  tz: string
): Promise<string[]> {
  const keys: string[] = [];
  for (const { client } of instances) {
    try {
      const items = await getItems(client);
      for (const item of items) {
        if (item.added) {
          const key = getLocalDateKey(item.added, tz);
          if (key) keys.push(key);
        }
      }
    } catch {}
  }
  return keys;
}

// Cumulative library size per day: everything added before the window is the
// baseline, then each day folds in that day's additions.
function cumulativeSeries(addedKeys: string[], days: string[], from: string): number[] {
  const baseline = addedKeys.reduce((n, k) => (k < from ? n + 1 : n), 0);
  const byDay = new Map<string, number>();
  for (const k of addedKeys) if (k >= from) byDay.set(k, (byDay.get(k) ?? 0) + 1);
  let running = baseline;
  return days.map((day) => {
    running += byDay.get(day) ?? 0;
    return running;
  });
}

async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('insights.view');
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const settings = await getOrCreateAppSettings();
  const tz = settings.timeZone;
  const todayKey = getLocalDateKey(new Date(), tz);

  const { searchParams } = new URL(request.url);
  const to = normalizeDateKey(searchParams.get('to')) ?? todayKey;
  let from = normalizeDateKey(searchParams.get('from')) ?? shiftDayKey(to, -29);
  // Keys are zero-padded YYYY-MM-DD, so lexicographic compare == chronological.
  // Reject inverted ranges rather than letting eachDayKey return an empty set
  // that masquerades as "no data".
  if (from > to) {
    return NextResponse.json({ error: "invalid date range: 'from' must be <= 'to'" }, { status: 400 });
  }
  // Keep the most-recent INSIGHTS_MAX_DAYS so an over-long range doesn't silently
  // drop its recent end (which would make `totals.total` a stale, ~year-old count).
  from = clampWindowStart(from, to);
  const days = eachDayKey(from, to);

  // Fetch only the libraries the user may view (mirrors /api/services/stats gating).
  const [movieKeys, seriesKeys, musicKeys] = await Promise.all([
    can(user, 'movies.view')
      ? collectAddedKeys(await getRadarrClients().catch(() => []), (c) => c.getMovies(), tz)
      : null,
    can(user, 'series.view')
      ? collectAddedKeys(await getSonarrClients().catch(() => []), (c) => c.getSeries(), tz)
      : null,
    can(user, 'music.view')
      ? collectAddedKeys(await getLidarrClients().catch(() => []), (c) => c.getArtists(), tz)
      : null,
  ]);

  const movies = movieKeys ? cumulativeSeries(movieKeys, days, from) : null;
  const series = seriesKeys ? cumulativeSeries(seriesKeys, days, from) : null;
  const music = musicKeys ? cumulativeSeries(musicKeys, days, from) : null;

  const total = days.map((_, i) =>
    (movies?.[i] ?? 0) + (series?.[i] ?? 0) + (music?.[i] ?? 0)
  );

  const last = <T,>(arr: T[] | null): T | null => (arr && arr.length ? arr[arr.length - 1] : null);

  return NextResponse.json({
    from,
    to,
    days,
    series: { movies, series, music, total },
    totals: {
      movies: last(movies),
      series: last(series),
      music: last(music),
      total: last(total),
    },
  });
}

export const GET = withApiLogging(getHandler, 'api/insights/library');
