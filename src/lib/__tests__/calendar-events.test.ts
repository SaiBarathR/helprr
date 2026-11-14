import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sonarr: vi.fn(),
  radarr: vi.fn(),
  lidarr: vi.fn(),
}));

const connection = (id: string) => ({ id, label: id });
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClients: async () => [{ connection: connection('sonarr'), client: { getCalendar: mocks.sonarr } }],
  getRadarrClients: async () => [{ connection: connection('radarr'), client: { getCalendar: mocks.radarr } }],
  getLidarrClients: async () => [{ connection: connection('lidarr'), client: { getCalendar: mocks.lidarr } }],
}));

import { fetchServiceCalendarEvents } from '@/lib/calendar-events';

const film = (id: number, inCinemas: string) => ({
  id, title: `Film ${id}`, year: 2026, studio: 'Studio', inCinemas, hasFile: false, monitored: true, images: [],
});
const album = (id: number, releaseDate: string) => ({
  id, title: `Album ${id}`, releaseDate, artistId: 1, monitored: true, images: [], artist: { artistName: 'Artist' },
});

beforeEach(() => {
  mocks.sonarr.mockResolvedValue([]);
  // Whatever Radarr and Lidarr return around the window; the days decide.
  mocks.radarr.mockResolvedValue([
    film(1, '2026-10-31T00:00:00Z'),
    film(2, '2026-11-01T00:00:00Z'),
    film(3, '2026-11-30T00:00:00Z'),
    film(4, '2026-12-01T00:00:00Z'),
  ]);
  mocks.lidarr.mockResolvedValue([album(5, '2026-11-01T00:00:00Z'), album(6, '2026-12-01T00:00:00Z')]);
});

const titles = async (start: string, end: string, timeZone: string) =>
  (await fetchServiceCalendarEvents(start, end, timeZone)).events.map((e) => e.subtitle.startsWith('Album') ? e.subtitle : e.title);

describe('fetchServiceCalendarEvents release days', () => {
  it("keeps November's first and last days west of UTC", async () => {
    // November in Los Angeles: Nov 1 00:00 PDT to Nov 30 23:59:59 PST.
    expect(await titles('2026-11-01T07:00:00.000Z', '2026-12-01T07:59:59.999Z', 'America/Los_Angeles'))
      .toEqual(['Film 2', 'Album 5', 'Film 3']);
  });

  it("does not take the next month's first day east of UTC", async () => {
    // November in India: Oct 31 18:30Z to Nov 30 18:29:59Z.
    expect(await titles('2026-10-31T18:30:00.000Z', '2026-11-30T18:29:59.999Z', 'Asia/Kolkata'))
      .toEqual(['Film 2', 'Album 5', 'Film 3']);
  });

  it('asks Radarr and Lidarr for a day more on each side, and Sonarr for the window', async () => {
    await fetchServiceCalendarEvents('2026-11-01T07:00:00.000Z', '2026-12-01T07:59:59.999Z', 'America/Los_Angeles');
    expect(mocks.sonarr).toHaveBeenCalledWith('2026-11-01T07:00:00.000Z', '2026-12-01T07:59:59.999Z');
    expect(mocks.radarr).toHaveBeenCalledWith('2026-10-31T07:00:00.000Z', '2026-12-02T07:59:59.999Z');
    expect(mocks.lidarr).toHaveBeenCalledWith('2026-10-31T07:00:00.000Z', '2026-12-02T07:59:59.999Z');
  });

  it('keeps the event date as upstream gave it', async () => {
    const { events } = await fetchServiceCalendarEvents('2026-11-01T07:00:00.000Z', '2026-12-01T07:59:59.999Z', 'America/Los_Angeles');
    expect(events.find((e) => e.title === 'Film 2')?.date).toBe('2026-11-01T00:00:00Z');
  });
});
