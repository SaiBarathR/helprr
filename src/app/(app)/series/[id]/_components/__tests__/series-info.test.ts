import { describe, expect, it } from 'vitest';
import type { SonarrSeries } from '@/types';
import { buildMonitorUpdate, formatAniListMappingState, formatCountdown, formatDateValue } from '../format';
import { buildSeasonDetailRows, buildSeriesInfoRows, seriesStatusBadge } from '../series-info';

const seasons = [{ seasonNumber: 0, monitored: true }, { seasonNumber: 1, monitored: true }, { seasonNumber: 2, monitored: false }, { seasonNumber: 3, monitored: true }];
const series = (extra: Record<string, unknown> = {}) => ({
  id: 7, title: 'X', seriesType: 'standard', monitored: true, seasonFolder: false, runtime: 0, path: '', added: '',
  status: 'ended', seasons, statistics: { seasonCount: 3, episodeFileCount: 3, episodeCount: 3, totalEpisodeCount: 3, sizeOnDisk: 0 }, ...extra,
}) as unknown as SonarrSeries;

describe('series page formatting', () => {
  it('formats a countdown, a date and a mapping state', () => {
    expect(formatCountdown(0)).toBe('0m');
    expect(formatCountdown(90061)).toBe('1d 1h 1m');
    expect(formatDateValue('2024-03-02')).toBe('Mar 2, 2024');
    expect(formatDateValue('not a date')).toBeNull();
    expect(formatDateValue(null)).toBeNull();
    expect(formatAniListMappingState('MANUAL_NONE')).toBe('Manually unmapped');
    expect(formatAniListMappingState(undefined)).toBe('Not mapped');
  });

  it('builds the series Sonarr should store for each monitoring option', () => {
    const monitoredOf = (option: string) => buildMonitorUpdate(series(), option).seasons.map((s) => s.monitored);
    expect(monitoredOf('firstSeason')).toEqual([false, true, false, false]);
    expect(monitoredOf('lastSeason')).toEqual([false, false, false, true]);
    expect(monitoredOf('none')).toEqual([false, false, false, false]);
    expect(monitoredOf('unmonitorSpecials')).toEqual([false, true, false, true]);
    expect(monitoredOf('all')).toEqual([true, true, true, true]);
    expect(buildMonitorUpdate(series(), 'none')).toEqual(expect.objectContaining({ monitored: false, addOptions: { monitor: 'none' } }));
    expect(buildMonitorUpdate(series(), 'future').monitored).toBe(true);
  });

  it('marks a series DOWNLOADED only when every episode has a file', () => {
    expect(seriesStatusBadge(series()).label).toBe('DOWNLOADED');
    expect(seriesStatusBadge(series({ status: 'continuing', statistics: { episodeFileCount: 1, episodeCount: 3 } }))).toEqual({ label: 'CONTINUING', className: 'bg-purple-500/20 text-purple-400' });
    expect(seriesStatusBadge(series({ status: undefined, statistics: undefined })).label).toBe('UNKNOWN');
  });

  it("fills an anime's show type, release date and next episode from AniList when TMDB has none", () => {
    const rows = buildSeriesInfoRows({
      series: series({ seriesType: 'anime' }),
      tmdbData: null,
      animeDetail: { format: 'TV_SHORT', startDate: { year: 2023, month: 9, day: 29 }, nextAiringEpisode: { episode: 12, airingAt: 1_800_000_000 } } as never,
      qualityProfileName: undefined,
      tagLabels: [],
      rootFolderPath: undefined,
    });
    const value = (label: string) => rows.find((row) => row.label === label)?.value;
    expect(value('Quality Profile')).toBe('Unknown');
    expect(value('Series Type')).toBe('Anime');
    expect(value('Show Type')).toBe('TV SHORT');
    expect(value('Release Date')).toBe('Sep 29, 2023');
    expect(value('Next Episode')).toMatch(/^Episode 12 · .+ at .+$/);
    expect(value('Added')).toBe('Unknown');
    expect(rows.some((row) => row.label === 'Tags' || row.label === 'Path' || row.label === 'Root Folder')).toBe(false);
  });

  it('lists season details only for seasons with statistics', () => {
    const rows = buildSeasonDetailRows(series({ seasons: [
      { seasonNumber: 0, statistics: { episodeFileCount: 0, episodeCount: 0, totalEpisodeCount: 2, sizeOnDisk: 0 } },
      { seasonNumber: 1 },
    ] }));
    expect(rows).toEqual([{ label: 'Season 0 (Specials)', value: 'Files 0/0 · Total 2' }]);
  });
});
