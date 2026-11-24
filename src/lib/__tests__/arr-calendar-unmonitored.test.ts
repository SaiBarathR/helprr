import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), create: vi.fn() }));
vi.mock('axios', () => ({
  default: { create: mocks.create.mockImplementation(() => ({ get: mocks.get, post: mocks.post })) },
}));

import { LidarrClient } from '@/lib/lidarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { SonarrClient } from '@/lib/sonarr-client';

const START = '2026-11-01T00:00:00.000Z';
const END = '2026-11-30T23:59:59.999Z';

// The *arrs return monitored items only unless the calendar call says
// unmonitored=true. The Calendar page asks for it; the poller's premiere alerts
// (src/lib/polling/upcoming.ts) and scheduled alerts use the default.
describe('arr calendar unmonitored opt-in', () => {
  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue({ data: [] });
  });

  it.each([
    ['Sonarr', () => new SonarrClient('http://sonarr.local', 'key'), '/api/v3/calendar', { includeSeries: true }],
    ['Radarr', () => new RadarrClient('http://radarr.local', 'key'), '/api/v3/calendar', {}],
    ['Lidarr', () => new LidarrClient('http://lidarr.local', 'key'), '/api/v1/calendar', { includeArtist: true }],
  ] as const)('%s asks for unmonitored items only when told to', async (_name, client, path, extra) => {
    await client().getCalendar(START, END);
    expect(mocks.get).toHaveBeenLastCalledWith(path, { params: { start: START, end: END, ...extra } });

    await client().getCalendar(START, END, { unmonitored: true });
    expect(mocks.get).toHaveBeenLastCalledWith(path, { params: { start: START, end: END, ...extra, unmonitored: true } });
  });
});

describe('Sonarr season pass', () => {
  it('sends the choice for each series and leaves their monitored flag to Sonarr', async () => {
    mocks.post.mockReset().mockResolvedValue({ data: {} });
    await new SonarrClient('http://sonarr.local', 'key').setSeriesMonitoring([3, 9], 'future');
    expect(mocks.post).toHaveBeenCalledWith('/api/v3/seasonpass', {
      series: [{ id: 3 }, { id: 9 }],
      monitoringOptions: { monitor: 'future' },
    }, undefined);
  });
});
