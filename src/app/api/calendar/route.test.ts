import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/types';

const mocks = vi.hoisted(() => ({
  user: { id: 'u1', role: 'member', template: 'member', permissions: {} as Record<string, boolean> },
  getCachedJson: vi.fn(),
  setCachedJson: vi.fn(),
  fetchEvents: vi.fn(),
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
  fetchScheduledCalendarEvents: async () => [],
  mergeCalendarWithScheduled: (events: CalendarEvent[]) => events,
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
});
