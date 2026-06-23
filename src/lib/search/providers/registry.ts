import { createLocalModuleHandler } from '@/lib/search/providers/local-module';
import { searchAnilist } from '@/lib/search/providers/anilist';
import { searchTmdb } from '@/lib/search/providers/tmdb';
import { searchNotifications } from '@/lib/search/providers/notifications';
import { searchTorrents } from '@/lib/search/providers/torrents';
import { searchActivity } from '@/lib/search/providers/activity';
import { searchRequests } from '@/lib/search/providers/requests';
import { searchProwlarr } from '@/lib/search/providers/prowlarr';
import type { ServerProviderEntry } from '@/lib/search/providers/types';
import type { SearchProviderId } from '@/lib/search/types';

export const SERVER_PROVIDER_HANDLERS: Record<SearchProviderId, ServerProviderEntry['handler']> = {
  series: createLocalModuleHandler('series'),
  movies: createLocalModuleHandler('movies'),
  music: createLocalModuleHandler('music'),
  watchlist: createLocalModuleHandler('watchlist'),
  tmdb: searchTmdb,
  anilist: searchAnilist,
  requests: searchRequests,
  torrents: searchTorrents,
  activity: searchActivity,
  notifications: searchNotifications,
  prowlarr: searchProwlarr,
};

export function getProviderHandler(id: SearchProviderId) {
  return SERVER_PROVIDER_HANDLERS[id];
}
