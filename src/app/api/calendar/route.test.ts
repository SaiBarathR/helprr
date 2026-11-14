import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/types';

const mocks = vi.hoisted(() => ({
  user: { id: 'u1', role: 'member', template: 'member', permissions: {} as Record<string, boolean> },
  getCachedJson: vi.fn(),
  setCachedJson: vi.fn(),
  fetchEvents: vi.fn(),
  scheduled: [] as unknown[],
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: async () => ({ ok: true, user: mocks.user }),
  requireUser: async () => ({ ok: true, user: mocks.user }),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/app-settings', () => ({ getOrCreateAppSettings: async () => ({ timeZone: 'UTC' }) }));
vi.mock('@/lib/cache/json-cache', () => ({ getCachedJson: mocks.getCachedJson, setCachedJson: mocks.setCachedJson }));
vi.mock('@/lib/calendar-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/calendar-events')>()),
  fetchServiceCalendarEvents: mocks.fetchEvents,
}));
vi.mock('@/lib/scheduled-alerts/calendar', () => ({
  fetchScheduledCalendarEvents: async () => mocks.scheduled,
  mergeCalendarWithScheduled: (events: CalendarEvent[], scheduled: CalendarEvent[]) => [...events, ...scheduled],
}));

import { GET } from './route';

const event = (id: string, type: CalendarEvent['type']) => ({
  id, type, title: id, subtitle: '', date: '2026-11-20T00:00:00Z', hasFile: false, monitored: true, images: [],
}) as CalendarEvent;
const EVENTS = [event('ep', 'episode'), event('film', 'movie'), event('album', 'album')];

const get = (query = '?start=2026-11-01T00:00:00Z&end=2026-12-01T00:00:00Z') =>
  GET(new NextRequest(`http://localhost/api/calendar${query}`));
const ids = async (res: Response) => ((await res.json()) as CalendarEvent[]).map((e) => e.id);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.permissions = {};
  mocks.scheduled = [];
  mocks.getCachedJson.mockResolvedValue(null);
  mocks.fetchEvents.mockResolvedValue({ events: EVENTS, cacheable: true });
});

describe('GET /api/calendar and music access', () => {
  it('lists album releases to a user with music.view', async () => {
    expect(await ids(await get())).toEqual(['ep', 'film', 'album']);
  });

  it('leaves them out without it, fresh or from the shared cache', async () => {
    mocks.user.permissions = { 'music.view': false };
    expect(await ids(await get())).toEqual(['ep', 'film']);
    expect(mocks.setCachedJson).toHaveBeenCalledWith('calendar', expect.any(String), EVENTS, 120);

    mocks.getCachedJson.mockResolvedValue(EVENTS);
    expect(await ids(await get())).toEqual(['ep', 'film']);
    expect(await ids(await get('?start=2026-11-01T00:00:00Z&end=2026-12-01T00:00:00Z&type=album'))).toEqual([]);
  });

  it('leaves out a music alert\'s own occurrences too, which come back as album events', async () => {
    mocks.user.permissions = { 'music.view': false };
    mocks.scheduled = [event('alert-album', 'album'), event('alert-film', 'movie')];
    expect(await ids(await get('?start=2026-11-01T00:00:00Z&end=2026-12-01T00:00:00Z&includeScheduled=true')))
      .toEqual(['ep', 'film', 'alert-film']);
  });
});

describe('GET /api/calendar release days', () => {
  it("matches release days on the device's time zone when the page sends one", async () => {
    await get('?start=2026-11-01T07:00:00Z&end=2026-12-01T07:59:59Z&tz=America/Los_Angeles');
    expect(mocks.fetchEvents).toHaveBeenCalledWith('2026-11-01T07:00:00Z', '2026-12-01T07:59:59Z', 'America/Los_Angeles');
    // Each zone has its own cache entry: the same window holds other days elsewhere.
    expect(mocks.getCachedJson.mock.calls[0][1]).toContain('America/Los_Angeles');
  });

  it("uses the app's time zone without one, or for a zone that is not real", async () => {
    await get('?start=2026-11-01T00:00:00Z&end=2026-12-01T00:00:00Z&tz=Not/AZone');
    expect(mocks.fetchEvents.mock.calls[0][2]).toBe('UTC');
    await get('?days=7');
    expect(mocks.fetchEvents.mock.calls[1][2]).toBe('UTC');
  });
});

describe("GET /api/calendar today (the Today widget's days=1&fullDay=true)", () => {
  afterEach(() => vi.useRealTimers());
  const today = (tz?: string) => get(`?days=1&fullDay=true${tz ? `&tz=${encodeURIComponent(tz)}` : ''}`);
  // The window as instants (the route writes them with the zone's offset).
  const instants = (call: unknown[]) => [new Date(call[0] as string).toISOString(), new Date(call[1] as string).toISOString(), call[2]];

  it("east of UTC just after midnight, today is the device's new day, not the server's", async () => {
    // 01:59 on Nov 15 in Auckland (UTC+13) is still Nov 14 in UTC.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T12:59:00Z'));
    await today('Pacific/Auckland');
    expect(instants(mocks.fetchEvents.mock.calls[0])).toEqual(['2026-11-14T11:00:00.000Z', '2026-11-15T10:59:59.999Z', 'Pacific/Auckland']);
    // Its own cache entry, on its own day: another zone's today is another window.
    expect(mocks.getCachedJson.mock.calls[0][1]).toContain('2026-11-15');
    expect(mocks.getCachedJson.mock.calls[0][1]).toContain('Pacific/Auckland');
  });

  it('west of UTC just before midnight, today is still the device\'s day', async () => {
    // 23:30 on Nov 14 in Los Angeles (UTC-8) is already Nov 15 in UTC.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T07:30:00Z'));
    await today('America/Los_Angeles');
    expect(instants(mocks.fetchEvents.mock.calls[0])).toEqual(['2026-11-14T08:00:00.000Z', '2026-11-15T07:59:59.999Z', 'America/Los_Angeles']);
    expect(mocks.getCachedJson.mock.calls[0][1]).toContain('2026-11-14');
  });

  it("keeps the app's day without a zone, or for one that is not real", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T07:30:00Z'));
    await today();
    await today('Not/AZone');
    for (const call of mocks.fetchEvents.mock.calls) {
      expect(instants(call)).toEqual(['2026-11-15T00:00:00.000Z', '2026-11-15T23:59:59.999Z', 'UTC']);
    }
    expect(mocks.getCachedJson.mock.calls[1][1]).not.toContain('Not/AZone');
  });
});
