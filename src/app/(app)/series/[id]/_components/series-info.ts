import { format } from 'date-fns';
import { formatBytes } from '@/lib/format';
import { formatFuzzyDate } from '@/lib/anilist-helpers';
import { formatLanguageCode, formatRegionCodes } from '@/lib/media-locale';
import type { DiscoverTvFullDetail, SonarrSeries } from '@/types';
import type { AniListDetailResponse } from '@/types/anilist';
import { formatDateValue } from './format';

export interface InfoRow {
  label: string;
  value: string;
}

/** The status badge: DOWNLOADED once every episode has a file, else Sonarr's status. */
export function seriesStatusBadge(series: SonarrSeries): { label: string; className: string } {
  const hasAllFiles = series.statistics
    ? series.statistics.episodeFileCount >= series.statistics.episodeCount && series.statistics.episodeCount > 0
    : false;
  return {
    label: hasAllFiles ? 'DOWNLOADED' : series.status?.toUpperCase() || 'UNKNOWN',
    className: hasAllFiles
      ? 'bg-green-500/20 text-green-400'
      : series.status === 'continuing'
        ? 'bg-purple-500/20 text-purple-400'
        : 'bg-muted text-muted-foreground',
  };
}

/** Sonarr's next airing, formatted, or null. */
export function formatNextAiring(series: SonarrSeries): string | null {
  return series.nextAiring
    ? format(new Date(series.nextAiring), "MMM d, yyyy 'at' h:mm a")
    : null;
}

/** The anime's own start date, as AniList gives it. */
export function animeStartDateOf(animeDetail: AniListDetailResponse | null): string | null {
  return formatFuzzyDate(animeDetail?.startDate ?? null);
}

/** The Information section's rows, in order: Sonarr's facts, then TMDB's and AniList's where Sonarr has none. */
export function buildSeriesInfoRows({
  series,
  tmdbData,
  animeDetail,
  qualityProfileName,
  tagLabels,
  rootFolderPath,
}: {
  series: SonarrSeries;
  tmdbData: DiscoverTvFullDetail | null;
  animeDetail: AniListDetailResponse | null;
  qualityProfileName: string | undefined;
  tagLabels: string[];
  rootFolderPath: string | undefined;
}): InfoRow[] {
  const isAnimeSeries = series.seriesType === 'anime';
  const firstAired = formatDateValue(series.firstAired);
  const lastAired = formatDateValue(series.lastAired);
  const previousAiring = formatDateValue(series.previousAiring, true);
  const releaseDate = formatDateValue(tmdbData?.releaseDate ?? series.releaseDate ?? null) ?? animeStartDateOf(animeDetail);
  const originCountry = formatRegionCodes(tmdbData?.originCountry);
  const originalLanguage = series.originalLanguage?.name
    || formatLanguageCode(tmdbData?.originalLanguage);
  const showType = tmdbData?.showType ?? (isAnimeSeries && animeDetail?.format ? animeDetail.format.replace(/_/g, ' ') : null);
  const runtimeValue = series.runtime > 0 ? `${series.runtime} min` : null;
  const tmdbNextEpisode = tmdbData?.nextEpisode
    ? [
      `S${tmdbData.nextEpisode.seasonNumber}E${tmdbData.nextEpisode.episodeNumber}`,
      tmdbData.nextEpisode.name,
      formatDateValue(tmdbData.nextEpisode.airDate),
    ].filter((part): part is string => Boolean(part)).join(' · ')
    : null;
  const animeNextEpisode = (() => {
    if (!animeDetail?.nextAiringEpisode) return null;
    const airDate = new Date(animeDetail.nextAiringEpisode.airingAt * 1000);
    const airDateText = Number.isFinite(airDate.getTime())
      ? format(airDate, "MMM d, yyyy 'at' h:mm a")
      : null;
    return [
      `Episode ${animeDetail.nextAiringEpisode.episode}`,
      airDateText,
    ].filter((part): part is string => Boolean(part)).join(' · ');
  })();
  const nextEpisode = tmdbNextEpisode || animeNextEpisode || formatNextAiring(series);

  const statisticsRows: InfoRow[] = [];
  if (series.statistics) {
    statisticsRows.push({ label: 'Season Count', value: String(series.statistics.seasonCount) });
    statisticsRows.push({ label: 'Episode File Count', value: String(series.statistics.episodeFileCount) });
    statisticsRows.push({ label: 'Episode Count', value: String(series.statistics.episodeCount) });
    statisticsRows.push({ label: 'Total Episode Count', value: String(series.statistics.totalEpisodeCount) });
    if (series.statistics.sizeOnDisk > 0) {
      statisticsRows.push({ label: 'Size on Disk', value: formatBytes(series.statistics.sizeOnDisk) });
    }
    if (series.statistics.releaseGroups?.length) {
      statisticsRows.push({ label: 'Release Groups', value: series.statistics.releaseGroups.join(', ') });
    }
    if (series.statistics.percentOfEpisodes != null) {
      statisticsRows.push({ label: 'Percent of Episodes', value: `${Number(series.statistics.percentOfEpisodes.toFixed(1))}%` });
    }
  }

  return [
    { label: 'Quality Profile', value: qualityProfileName || 'Unknown' },
    { label: 'Series Type', value: series.seriesType.charAt(0).toUpperCase() + series.seriesType.slice(1) },
    ...(showType ? [{ label: 'Show Type', value: showType }] : []),
    ...(series.certification ? [{ label: 'Certification', value: series.certification }] : []),
    ...(runtimeValue ? [{ label: 'Runtime', value: runtimeValue }] : []),
    ...(firstAired ? [{ label: 'First Aired', value: firstAired }] : []),
    ...(lastAired ? [{ label: 'Last Aired', value: lastAired }] : []),
    ...(previousAiring ? [{ label: 'Previous Airing', value: previousAiring }] : []),
    ...(releaseDate ? [{ label: 'Release Date', value: releaseDate }] : []),
    ...(originalLanguage ? [{ label: 'Original Language', value: originalLanguage }] : []),
    ...(originCountry ? [{ label: 'Origin Country', value: originCountry }] : []),
    ...(nextEpisode ? [{ label: 'Next Episode', value: nextEpisode }] : []),
    ...(tagLabels.length > 0 ? [{ label: 'Tags', value: tagLabels.join(', ') }] : []),
    ...(series.path ? [{ label: 'Path', value: series.path }] : []),
    ...(rootFolderPath ? [{ label: 'Root Folder', value: rootFolderPath }] : []),
    { label: 'New Seasons', value: series.monitored ? 'Monitored' : 'Not Monitored' },
    { label: 'Season Folders', value: series.seasonFolder ? 'Yes' : 'No' },
    ...statisticsRows,
    {
      label: 'Added',
      value: series.added ? format(new Date(series.added), 'MMM d, yyyy') : 'Unknown',
    },
  ];
}

/** One row per season with statistics: files, totals, size, coverage, last airing and groups. */
export function buildSeasonDetailRows(series: SonarrSeries): InfoRow[] {
  return series.seasons
    .map((season) => {
      const stats = season.statistics;
      if (!stats) return null;
      const previousSeasonAiring = formatDateValue(stats.previousAiring, true);

      const parts = [
        `Files ${stats.episodeFileCount}/${stats.episodeCount}`,
        `Total ${stats.totalEpisodeCount}`,
        stats.sizeOnDisk > 0 ? `Size ${formatBytes(stats.sizeOnDisk)}` : null,
        stats.percentOfEpisodes != null ? `Coverage ${Number(stats.percentOfEpisodes.toFixed(1))}%` : null,
        previousSeasonAiring ? `Previous ${previousSeasonAiring}` : null,
        stats.releaseGroups?.length ? `Groups ${stats.releaseGroups.join(', ')}` : null,
      ].filter((part): part is string => Boolean(part));

      if (parts.length === 0) return null;

      return {
        label: season.seasonNumber === 0 ? 'Season 0 (Specials)' : `Season ${season.seasonNumber}`,
        value: parts.join(' · '),
      };
    })
    .filter((row): row is InfoRow => row !== null);
}
