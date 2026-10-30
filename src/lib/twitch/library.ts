import type { JellyfinClient } from '@/lib/jellyfin-client';

/** Everything from the NFO files: a Twitch folder must never be matched against a TV database. */
export function twitchLibraryOptions(path: string) {
  const noFetchers = { MetadataFetchers: [], MetadataFetcherOrder: [], ImageFetchers: [], ImageFetcherOrder: [] };
  return {
    Enabled: true,
    EnableRealtimeMonitor: true,
    EnableInternetProviders: false,
    EnableChapterImageExtraction: true,
    ExtractChapterImagesDuringLibraryScan: true,
    EnableTrickplayImageExtraction: false,
    EnableEmbeddedTitles: false,
    EnableEmbeddedEpisodeInfos: false,
    AutomaticRefreshIntervalDays: 0,
    SaveLocalMetadata: false,
    MetadataSavers: [],
    LocalMetadataReaderOrder: ['Nfo'],
    PathInfos: [{ Path: path }],
    TypeOptions: [
      { Type: 'Series', ...noFetchers },
      { Type: 'Season', ...noFetchers },
      { Type: 'Episode', ...noFetchers, ImageFetchers: ['Screen Grabber'], ImageFetcherOrder: ['Screen Grabber'] },
    ],
  };
}

function coversPath(libraryPath: string, path: string): boolean {
  const root = libraryPath.replace(/\/+$/, '');
  return path === root || path.startsWith(`${root}/`);
}

export interface TwitchLibraryStatus {
  exists: boolean;
  itemId: string | null;
  name: string | null;
  pathMatches: boolean;
  fetchersOff: boolean;
  /** Another library would also scan these folders, with its own fetchers. */
  conflicts: string[];
}

export async function readLibraryStatus(client: JellyfinClient, path: string): Promise<TwitchLibraryStatus> {
  const folders = await client.getVirtualFolders();
  const library = folders.find((folder) => (folder.Locations ?? []).some((location) => location.replace(/\/+$/, '') === path.replace(/\/+$/, '')));
  const options = library?.LibraryOptions as {
    TypeOptions?: Array<{ Type: string; MetadataFetchers?: string[]; ImageFetchers?: string[] }>;
  } | undefined;
  // Episodes keep the local Screen Grabber; anything else would reach the internet.
  const fetchersOff = (options?.TypeOptions ?? []).every((type) =>
    !type.MetadataFetchers?.length && !(type.ImageFetchers ?? []).some((fetcher) => fetcher !== 'Screen Grabber'));
  return {
    exists: Boolean(library),
    itemId: library?.ItemId ?? null,
    name: library?.Name ?? null,
    pathMatches: Boolean(library),
    fetchersOff: Boolean(library) && fetchersOff,
    conflicts: folders
      .filter((folder) => folder !== library && (folder.Locations ?? []).some((location) => coversPath(location, path)))
      .map((folder) => folder.Name ?? 'Unnamed library'),
  };
}
