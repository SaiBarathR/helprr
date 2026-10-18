import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSonarrClients: vi.fn(), getRadarrClients: vi.fn(async () => [] as unknown[]), nextAiring: vi.fn() }));

vi.mock('@/lib/service-helpers', () => ({ getSonarrClients: mocks.getSonarrClients, getRadarrClients: mocks.getRadarrClients }));
vi.mock('@/lib/anilist-client', () => ({ getAnimeNextAiringEpisode: mocks.nextAiring }));

import type { ScheduledAlert } from '@prisma/client';
import { AxiosError, AxiosHeaders } from 'axios';
import { jobReports, type JobReport } from '@/lib/polling-job-report';
import { createResolverContext, resolveAlertOccurrencesResult } from '@/lib/scheduled-alerts/resolver';

// One instance answering is enough to resolve the alert, but the polling job
// that asked the other one still failed.
describe('resolving a scheduled alert across instances', () => {
  it('reports an instance that did not answer even when another did', async () => {
    mocks.getSonarrClients.mockResolvedValue([
      { connection: { id: 's1' }, client: { getCalendar: async () => { throw new Error('Sonarr answered 500'); } } },
      { connection: { id: 's2' }, client: { getCalendar: async () => [] } },
    ]);
    const alert = {
      scheduleMode: 'release_relative', source: 'SONARR', mediaType: 'series', externalId: '1', title: 'Show',
      subtitle: null, posterUrl: null, href: null, instanceId: null, metadata: {}, scope: 'series',
      releaseTypes: ['episode'], offsetMinutes: 0, timeZone: 'UTC',
    } as unknown as ScheduledAlert;
    const report: JobReport = { failure: null, skipped: false };

    const result = await jobReports.run(report, () => resolveAlertOccurrencesResult(alert, createResolverContext()));

    expect(result).toEqual({ candidates: [], resolved: true });
    expect(report.failure).toBe('Sonarr answered 500');
  });

  const movieAlert = {
    scheduleMode: 'release_relative', source: 'RADARR', mediaType: 'movie', externalId: '5', title: 'Film',
    subtitle: null, posterUrl: null, href: null, instanceId: null, metadata: {}, scope: 'movie',
    releaseTypes: ['digital'], offsetMinutes: 0, timeZone: 'UTC',
  } as unknown as ScheduledAlert;
  const status = (code: number) => new AxiosError('Request failed', undefined, undefined, undefined, {
    status: code, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: null,
  });
  const resolveInJob = async (alert: ScheduledAlert) => {
    const report: JobReport = { failure: null, skipped: false };
    const result = await jobReports.run(report, () => resolveAlertOccurrencesResult(alert, createResolverContext()));
    return { result, report };
  };

  it('reports a film lookup that failed even when the calendar answered, but not a film Radarr no longer has', async () => {
    const getMovieById = vi.fn(async () => { throw status(500); });
    mocks.getRadarrClients.mockResolvedValue([{ connection: { id: 'r1' }, client: { getMovieById, getCalendar: async () => [] } }]);

    const failed = await resolveInJob(movieAlert);
    expect(failed.result.resolved).toBe(true);
    expect(failed.report.failure).not.toBeNull();

    getMovieById.mockRejectedValueOnce(status(404));
    expect((await resolveInJob(movieAlert)).report.failure).toBeNull();
  });

  it('reports instances that could not be listed', async () => {
    mocks.getRadarrClients.mockRejectedValueOnce(new Error('database unavailable'));

    expect((await resolveInJob(movieAlert)).report.failure).toBe('database unavailable');
  });

  it('reports an AniList airing lookup that failed', async () => {
    mocks.nextAiring.mockRejectedValueOnce(new Error('AniList answered 500'));
    const anime = { ...movieAlert, source: 'ANILIST', mediaType: 'anime', externalId: '21', scope: 'series', releaseTypes: ['airing'] } as unknown as ScheduledAlert;

    expect((await resolveInJob(anime)).report.failure).toBe('AniList answered 500');
  });
});
