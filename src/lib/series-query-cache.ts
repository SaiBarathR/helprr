// Cross-view cache coordination for the Sonarr series / season / episode pages.
// Replaces series-route-cache's patchEpisode(s)AcrossSnapshots: instead of three
// bespoke snapshot Maps, the three views share TanStack query keys and an episode
// monitor/file change on any view is mirrored into the others via setQueryData.
//
// The series object itself needs no patch helper — all three views read it from
// the single shared queryKeys.detail('sonarr', …) key, so a PUT that returns the
// updated series just setQueryData's that one key.

import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import type { EpisodeWithFile, SonarrEpisode } from '@/types';

const inst = (id?: string) => id ?? 'default';

// Episode list WITH file info (the episode detail view). Distinct prefix from the
// slim queryKeys.episodes list used by the series + season views so they cache
// independently but can both be patched together.
export function episodesWithFileKey(seriesId: number, instanceId?: string) {
  return ['sonarr', 'episodes', 'withfile', inst(instanceId), seriesId] as const;
}

// TMDB season detail (episode stills/ratings). Shared by the series-detail
// expanded season list, the season page, and the episode page.
export function tvSeasonKey(tmdbId: number, seasonNumber: number) {
  return ['discover', 'tv', tmdbId, 'season', seasonNumber] as const;
}

// Apply episode updates to BOTH cached episode lists (slim + with-file) so an
// episode monitor/file change on any of the series-detail / season / episode
// views reflects on the others.
export function patchEpisodesInCache(
  queryClient: QueryClient,
  seriesId: number,
  instanceId: string | undefined,
  updates: Array<{ episodeId: number; updater: (episode: SonarrEpisode) => SonarrEpisode }>,
) {
  if (updates.length === 0) return;
  const updaterMap = new Map(updates.map((u) => [u.episodeId, u.updater] as const));

  queryClient.setQueryData<SonarrEpisode[]>(queryKeys.episodes(seriesId, instanceId), (prev) =>
    prev
      ? prev.map((episode) => {
          const updater = updaterMap.get(episode.id);
          return updater ? { ...episode, ...updater(episode) } : episode;
        })
      : prev,
  );
  queryClient.setQueryData<EpisodeWithFile[]>(episodesWithFileKey(seriesId, instanceId), (prev) =>
    prev
      ? prev.map((episode) => {
          const updater = updaterMap.get(episode.id);
          return updater ? ({ ...episode, ...updater(episode) } as EpisodeWithFile) : episode;
        })
      : prev,
  );
}
