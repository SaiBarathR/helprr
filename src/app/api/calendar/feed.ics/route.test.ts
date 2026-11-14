import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/types';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  userSettings: vi.fn(async () => null as { timeZone: string | null } | null),
  timeZone: 'UTC',
  updateMany: vi.fn(),
  evalScript: vi.fn(),
  redisGet: vi.fn(),
  redisTtl: vi.fn(),
  getRedisClient: vi.fn(),
  fetchEvents: vi.fn(),
  getCachedJson: vi.fn(),
  setCachedJson: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    calendarFeedToken: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
    userSettings: { findUnique: mocks.userSettings },
  },
}));
vi.mock('@/lib/redis', () => ({ getRedisClient: mocks.getRedisClient }));
vi.mock('@/lib/calendar-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/calendar-events')>()),
  fetchServiceCalendarEvents: mocks.fetchEvents,
}));
vi.mock('@/lib/cache/json-cache', () => ({ getCachedJson: mocks.getCachedJson, setCachedJson: mocks.setCachedJson }));
vi.mock('@/lib/app-settings', () => ({ getOrCreateAppSettings: async () => ({ timeZone: mocks.timeZone }) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));

import { GET } from './route';
import { generateFeedToken, hashFeedToken } from '@/lib/calendar-feed/token';

const TOKEN = generateFeedToken();

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'sonarr-hd-1',
    type: 'episode',
    title: 'Show',
    subtitle: 'S01E01 - One',
    date: '2026-11-10T01:00:00Z',
    hasFile: false,
    monitored: true,
    images: [],
    instanceId: 'hd',
    instanceLabel: 'HD',
    ...overrides,
  };
}

const EVENTS = [
  event({}),
  event({ id: 'sonarr-4k-2', instanceId: '4k', monitored: false }),
  event({ id: 'radarr-hd-3-digital', type: 'movie', title: 'Film', releaseType: 'digital' }),
  event({ id: 'lidarr-music-4', type: 'album', title: 'Artist', subtitle: 'Album', instanceId: 'music' }),
];

function feedRow(user: Record<string, unknown> = {}) {
  return {
    id: 'feed-1',
    tokenHash: hashFeedToken(TOKEN),
    name: 'Calendar',
    type: null as string | null,
    instanceId: null as string | null,
    monitoredOnly: false,
    lastUsedAt: null,
    user: { id: 'u1', username: 'member', role: 'member', template: 'member', permissions: {}, status: 'active', ...user },
  };
}

function get(query: string, headers: Record<string, string> = {}) {
  return GET(new NextRequest(`http://localhost/api/calendar/feed.ics${query}`, { headers }));
}

function uids(text: string): string[] {
  return [...text.matchAll(/^UID:(.*)$/gm)].map((match) => match[1].trim());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.getRedisClient.mockResolvedValue({ eval: mocks.evalScript, get: mocks.redisGet, ttl: mocks.redisTtl });
  mocks.evalScript.mockResolvedValue(['1', '900']);
  mocks.redisGet.mockResolvedValue(null);
  mocks.redisTtl.mockResolvedValue(-2);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findUnique.mockResolvedValue(feedRow());
  mocks.getCachedJson.mockResolvedValue(null);
  mocks.fetchEvents.mockResolvedValue({ events: EVENTS, cacheable: true });
});

describe('GET /api/calendar/feed.ics', () => {
  it('serves an iCalendar document to a current token', async () => {
    const res = await get(`?token=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
    const text = await res.text();
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(uids(text)).toHaveLength(4);
    // Looked up by hash; the token itself never reaches the database.
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashFeedToken(TOKEN) } }));
    expect(JSON.stringify(mocks.findUnique.mock.calls)).not.toContain(TOKEN);
  });

  it('reads a window from 30 days back to 180 days ahead', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-07T10:00:00Z'), toFake: ['Date'] });
    try {
      await get(`?token=${TOKEN}`);
    } finally {
      vi.useRealTimers();
    }
    const [start, end] = mocks.fetchEvents.mock.calls[0] as [string, string];
    expect(new Date(start).toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(new Date(end).toISOString()).toBe('2027-05-06T00:00:00.000Z');
  });

  it.each([
    ['', 'no token'],
    ['?token=', 'an empty token'],
    ['?token=not-a-token', 'a malformed token'],
  ])('answers %s (%s) with a bare 404 and no lookup', async (query) => {
    const res = await get(query);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not found');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['a revoked or rotated token', null],
    ['a disabled owner', feedRow({ status: 'disabled' })],
    ['an owner who lost calendar.view', feedRow({ permissions: { 'calendar.view': false } })],
  ])('refuses %s with the same 404', async (_label, found) => {
    mocks.findUnique.mockResolvedValue(found);
    const res = await get(`?token=${TOKEN}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not found');
    expect(mocks.fetchEvents).not.toHaveBeenCalled();
  });

  it('rate-limits a live token, before calling the instances', async () => {
    mocks.evalScript.mockResolvedValue(['31', '600']);
    const res = await get(`?token=${TOKEN}`);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('600');
    expect(mocks.fetchEvents).not.toHaveBeenCalled();
    expect(mocks.evalScript.mock.calls[0][1]).toMatchObject({ keys: [`calendar-feed:rate:${hashFeedToken(TOKEN)}`] });
  });

  it('gives an unknown token no rate-limit bucket (and, without a trusted proxy, no per-IP count)', async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect((await get(`?token=${TOKEN}`)).status).toBe(404);
    expect(mocks.evalScript).not.toHaveBeenCalled();
  });

  describe('per-IP refused tokens, behind a trusted proxy', () => {
    const FROM = { 'x-forwarded-for': '203.0.113.7' };
    beforeEach(() => vi.stubEnv('TRUST_FORWARDED_PROTO', 'true'));

    it('counts a refused token against the client IP and still answers the same 404', async () => {
      mocks.findUnique.mockResolvedValue(null);
      const res = await get(`?token=${TOKEN}`, FROM);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('Not found');
      expect(mocks.redisGet).toHaveBeenCalledWith('calendar-feed:misses:203.0.113.7');
      expect(mocks.evalScript).toHaveBeenCalledTimes(1);
      expect(mocks.evalScript.mock.calls[0][1]).toMatchObject({ keys: ['calendar-feed:misses:203.0.113.7'], arguments: ['900'] });
    });

    it('does not count a token that opens a feed', async () => {
      expect((await get(`?token=${TOKEN}`, FROM)).status).toBe(200);
      expect(mocks.evalScript).toHaveBeenCalledTimes(1);
      expect(mocks.evalScript.mock.calls[0][1]).toMatchObject({ keys: [`calendar-feed:rate:${hashFeedToken(TOKEN)}`] });
    });

    it('holds a client at the cap at 429 for any token, without a lookup or extending the window', async () => {
      mocks.redisGet.mockResolvedValue('30');
      mocks.redisTtl.mockResolvedValue(420);
      const res = await get(`?token=${TOKEN}`, FROM);
      expect(res.status).toBe(429);
      expect(res.headers.get('retry-after')).toBe('420');
      expect(mocks.findUnique).not.toHaveBeenCalled();
      expect(mocks.evalScript).not.toHaveBeenCalled();
    });

    it('lets a client under the cap through', async () => {
      mocks.redisGet.mockResolvedValue('29');
      expect((await get(`?token=${TOKEN}`, FROM)).status).toBe(200);
    });

    it('does not count a malformed token, which never reaches the database', async () => {
      expect((await get('?token=not-a-token', FROM)).status).toBe(404);
      expect(mocks.getRedisClient).not.toHaveBeenCalled();
    });

    it('fails closed when the per-IP count cannot be read', async () => {
      mocks.getRedisClient.mockRejectedValue(new Error('down'));
      expect((await get(`?token=${TOKEN}`, FROM)).status).toBe(503);
      expect(mocks.findUnique).not.toHaveBeenCalled();
    });

    it('still answers 404 when the miss cannot be recorded', async () => {
      mocks.findUnique.mockResolvedValue(null);
      mocks.evalScript.mockRejectedValue(new Error('down'));
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect((await get(`?token=${TOKEN}`, FROM)).status).toBe(404);
      expect(error).toHaveBeenCalledWith('[CalendarFeed] Failed to record a miss: Error');
    });
  });

  it('fails closed when the rate limiter is unreachable', async () => {
    mocks.getRedisClient.mockRejectedValue(new Error('down'));
    const res = await get(`?token=${TOKEN}`);
    expect(res.status).toBe(503);
    expect(mocks.fetchEvents).not.toHaveBeenCalled();
  });

  it.each([
    ['type', '&type=episode', ['sonarr-hd-1@helprr', 'sonarr-4k-2@helprr']],
    ['instance', '&instance=hd', ['sonarr-hd-1@helprr', 'radarr-hd-3-digital@helprr']],
    ['monitored', '&monitored=1', ['sonarr-hd-1@helprr', 'radarr-hd-3-digital@helprr', 'lidarr-music-4@helprr']],
    ['all three', '&type=episode&instance=4k&monitored=1', []],
    ['all', '&type=all&instance=all&monitored=0', ['sonarr-hd-1@helprr', 'sonarr-4k-2@helprr', 'radarr-hd-3-digital@helprr', 'lidarr-music-4@helprr']],
  ])('applies the %s filter', async (_label, query, expected) => {
    const res = await get(`?token=${TOKEN}${query}`);
    expect(res.status).toBe(200);
    expect(uids(await res.text())).toEqual(expected);
  });

  it.each(['&type=series', '&instance=a%20b', '&instance=' + 'x'.repeat(65), '&monitored=yes'])(
    'rejects the malformed filter %s',
    async (query) => {
      const res = await get(`?token=${TOKEN}${query}`);
      expect(res.status).toBe(400);
      expect(mocks.fetchEvents).not.toHaveBeenCalled();
    },
  );

  it('leaves album releases out for an owner without music access', async () => {
    mocks.findUnique.mockResolvedValue(feedRow({ permissions: { 'music.view': false } }));
    const text = await (await get(`?token=${TOKEN}`)).text();
    expect(uids(text)).toHaveLength(3);
    expect(text).not.toContain('lidarr-music-4');
    // The shared cache still holds every event, for owners who may see music.
    expect(mocks.setCachedJson).toHaveBeenCalledWith('calendar', expect.any(String), EVENTS, expect.any(Number));
  });

  it("applies the link's own filters, and a URL's filters narrow them further", async () => {
    mocks.findUnique.mockResolvedValue({ ...feedRow(), name: 'HD', instanceId: 'hd' });
    let res = await get(`?token=${TOKEN}`);
    const text = await res.text();
    expect(uids(text)).toEqual(['sonarr-hd-1@helprr', 'radarr-hd-3-digital@helprr']);
    expect(text).toContain('X-WR-CALNAME:Helprr · HD');

    res = await get(`?token=${TOKEN}&type=movie`);
    expect(uids(await res.text())).toEqual(['radarr-hd-3-digital@helprr']);
    // A URL cannot widen a link: another instance shows nothing.
    res = await get(`?token=${TOKEN}&instance=4k`);
    expect(uids(await res.text())).toEqual([]);
  });

  it('dates a release on its own day, west of UTC too', async () => {
    mocks.timeZone = 'America/New_York';
    try {
      mocks.getCachedJson.mockResolvedValue([event({ id: 'radarr-hd-3-digital', type: 'movie', title: 'Film', releaseType: 'digital', date: '2026-12-31T00:00:00Z' })]);
      const text = await (await get(`?token=${TOKEN}`)).text();
      expect(text).toContain('DTSTART;VALUE=DATE:20261231');
    } finally {
      mocks.timeZone = 'UTC';
    }
  });

  it("reads the window's days in the link owner's own time zone, over the app's", async () => {
    mocks.timeZone = 'UTC';
    mocks.userSettings.mockResolvedValueOnce({ timeZone: 'America/New_York' });
    vi.useFakeTimers({ now: new Date('2026-11-07T10:00:00Z'), toFake: ['Date'] });
    try {
      await get(`?token=${TOKEN}`);
    } finally {
      vi.useRealTimers();
    }
    expect(mocks.userSettings).toHaveBeenCalledWith({ where: { userId: 'u1' }, select: { timeZone: true } });
    const [start, , timeZone] = mocks.fetchEvents.mock.calls[0] as [string, string, string];
    // Midnight in New York (EDT), 30 days back.
    expect(new Date(start).toISOString()).toBe('2026-10-08T04:00:00.000Z');
    expect(timeZone).toBe('America/New_York');
  });

  it("falls back to the app's time zone when the owner's is not a real one", async () => {
    mocks.timeZone = 'America/New_York';
    mocks.userSettings.mockResolvedValueOnce({ timeZone: 'Not/AZone' });
    try {
      await get(`?token=${TOKEN}`);
      expect(mocks.fetchEvents.mock.calls[0][2]).toBe('America/New_York');
    } finally {
      mocks.timeZone = 'UTC';
    }
  });

  it('rejects a malformed filter only after the token checks', async () => {
    mocks.findUnique.mockResolvedValue(null);
    const res = await get(`?token=${TOKEN}&type=series`);
    expect(res.status).toBe(404);
  });

  it('serves cached events without calling the instances', async () => {
    mocks.getCachedJson.mockResolvedValue([EVENTS[0]]);
    const res = await get(`?token=${TOKEN}`);
    expect(uids(await res.text())).toEqual(['sonarr-hd-1@helprr']);
    expect(mocks.fetchEvents).not.toHaveBeenCalled();
  });

  it('answers 503 and caches nothing when every instance failed', async () => {
    mocks.fetchEvents.mockResolvedValue({ events: [], cacheable: false });
    const res = await get(`?token=${TOKEN}`);
    expect(res.status).toBe(503);
    expect(mocks.setCachedJson).not.toHaveBeenCalled();
  });
});
