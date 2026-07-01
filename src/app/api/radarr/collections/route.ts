import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient, getRadarrClients } from '@/lib/service-helpers';
import { resolveConnection } from '@/lib/arr-instances';
import { RadarrClient } from '@/lib/radarr-client';
import { requireAuth, requireCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { getCachedTaggedLibrary, invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { getCachedJson } from '@/lib/cache/json-cache';
import type {
  CollectionMovieSummary,
  CollectionSummary,
  MediaImage,
  RadarrCollection,
  RadarrMovie,
  RadarrLookupResult,
} from '@/types';

const COLLECTIONS_SCOPE = 'radarr-collections';

const COLLECTIONS_CACHE_HEADERS = {
  // Revalidate every read instead of replaying a stale copy: a browser cache is per-device
  // and can't be busted by a mutation (here or on another device), so max-age would keep
  // showing a removed movie / stale missing-count until it expires. Served fast from Redis.
  'Cache-Control': 'private, no-cache',
  // Partition the private cache by session cookie so a capability-gated response can't be
  // replayed from the browser cache to a different (or logged-out) user within the TTL.
  'Vary': 'Cookie',
} as const;

function posterRemoteUrl(images?: MediaImage[]): string | null {
  const poster = images?.find((img) => img.coverType === 'poster');
  return poster?.remoteUrl ?? poster?.url ?? null;
}

type LibraryEntry = { id: number; hasFile: boolean; monitored: boolean };
type TaggedCollection = RadarrCollection & { instanceId?: string; instanceLabel?: string };

function buildSummary(collection: TaggedCollection, libByTmdb: Map<number, LibraryEntry>): CollectionSummary {
  const genres = new Set<string>();
  const movies: CollectionMovieSummary[] = collection.movies.map((m) => {
    const lib = libByTmdb.get(m.tmdbId);
    for (const g of m.genres ?? []) genres.add(g);
    return {
      tmdbId: m.tmdbId,
      title: m.title,
      year: m.year,
      poster: posterRemoteUrl(m.images),
      inLibrary: lib != null || m.isExisting === true,
      monitored: m.monitored ?? false,
      movieId: lib?.id,
      hasFile: lib?.hasFile,
    };
  });
  const missingMovies =
    typeof collection.missingMovies === 'number'
      ? collection.missingMovies
      : movies.filter((m) => !m.inLibrary).length;

  return {
    id: collection.id,
    title: collection.title,
    tmdbId: collection.tmdbId,
    monitored: collection.monitored,
    overview: collection.overview,
    poster: posterRemoteUrl(collection.images),
    genres: [...genres].slice(0, 8),
    movieCount: movies.length,
    missingMovies,
    movies,
    instanceId: collection.instanceId,
    instanceLabel: collection.instanceLabel,
  };
}

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('movies.view');
  if (capError) return capError;
  const startedAt = performance.now();

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const cacheKeySeed = instanceId ?? 'all';

    // One connection resolution shared by both caches' miss paths (collections + library).
    let instancesPromise:
      | Promise<{ connection: { id: string; label: string }; client: RadarrClient }[]>
      | undefined;
    const resolveInstances = () =>
      (instancesPromise ??= instanceId
        ? resolveConnection('RADARR', instanceId).then((conn) => [
            { connection: conn, client: new RadarrClient(conn.url, conn.apiKey) },
          ])
        : getRadarrClients());

    // Collections AND the movie library, both from the shared tagged-library cache. The
    // 'radarr' entry is the SAME one the /api/radarr list view populates, so a warm cache
    // serves both with zero upstream calls. The library gives us tmdbId → radarr movieId,
    // so existing collection movies can deep-link and be searched.
    const [collectionsResult, libraryResult] = await Promise.all([
      getCachedTaggedLibrary<RadarrClient, RadarrCollection>({
        scope: COLLECTIONS_SCOPE,
        cacheKeySeed,
        getInstances: resolveInstances,
        fetchOne: (client) => client.getCollections(),
      }),
      getCachedTaggedLibrary<RadarrClient, RadarrMovie>({
        scope: 'radarr',
        cacheKeySeed,
        getInstances: resolveInstances,
        fetchOne: (client) => client.getMovies(),
      }),
    ]);

    // Per-instance lookup so movie ids that repeat across instances stay distinct.
    const libByInstance = new Map<string, Map<number, LibraryEntry>>();
    for (const mv of libraryResult.items) {
      let perInstance = libByInstance.get(mv.instanceId);
      if (!perInstance) {
        perInstance = new Map();
        libByInstance.set(mv.instanceId, perInstance);
      }
      perInstance.set(mv.tmdbId, { id: mv.id, hasFile: mv.hasFile, monitored: mv.monitored });
    }
    const EMPTY = new Map<number, LibraryEntry>();

    const summaries = collectionsResult.items
      .map((c) => buildSummary(c, libByInstance.get(c.instanceId) ?? EMPTY))
      .sort((a, b) => a.title.localeCompare(b.title));

    logApiDuration('/api/radarr/collections', startedAt, {
      method: 'GET',
      collectionCount: summaries.length,
      cached: collectionsResult.cached,
    });
    return NextResponse.json(summaries, { headers: COLLECTIONS_CACHE_HEADERS });
  } catch (error) {
    logApiDuration('/api/radarr/collections', startedAt, { method: 'GET', failed: true });
    const message = error instanceof Error ? error.message : 'Failed to fetch collections';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Add a missing movie from a collection, applying that collection's own defaults
// (quality profile / root folder / minimum availability / search) the way Radarr does.
async function postHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('movies.add');
  if (capError) return capError;
  const startedAt = performance.now();

  try {
    const body = await request.json();
    const instanceId = typeof body.instanceId === 'string' ? body.instanceId : undefined;
    const collectionId = Number(body.collectionId);
    const tmdbId = Number(body.tmdbId);
    const search: boolean | undefined = typeof body.search === 'boolean' ? body.search : undefined;
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
      return NextResponse.json({ error: 'tmdbId is required' }, { status: 400 });
    }
    if (!Number.isFinite(collectionId) || collectionId <= 0) {
      return NextResponse.json({ error: 'collectionId is required' }, { status: 400 });
    }

    const client = await getRadarrClient(instanceId);

    // Collection defaults — prefer the warm cache, fall back to a live fetch.
    const cacheKeySeed = instanceId ?? 'all';
    const cachedCollections = await getCachedJson<TaggedCollection[]>(COLLECTIONS_SCOPE, cacheKeySeed);
    const collections = cachedCollections ?? (await client.getCollections());
    const collection = collections.find((c) => c.id === collectionId);
    // Require a real collection — never silently fall back to arbitrary defaults
    // (first quality profile / root folder) for an unresolved collection.
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 400 });
    }

    const meta = (await client.lookupMovie(`tmdb:${tmdbId}`)).find(
      (r: RadarrLookupResult) => r.tmdbId === tmdbId
    );
    if (!meta) {
      return NextResponse.json({ error: 'Movie metadata not found on TMDB' }, { status: 404 });
    }

    let qualityProfileId = collection.qualityProfileId;
    if (!qualityProfileId) qualityProfileId = (await client.getQualityProfiles())[0]?.id;
    let rootFolderPath = collection.rootFolderPath;
    if (!rootFolderPath) rootFolderPath = (await client.getRootFolders())[0]?.path;
    if (!qualityProfileId || !rootFolderPath) {
      return NextResponse.json(
        { error: 'Radarr has no quality profile or root folder configured' },
        { status: 400 }
      );
    }

    const payload = {
      title: meta.title,
      tmdbId: meta.tmdbId,
      year: meta.year,
      titleSlug: meta.titleSlug,
      images: meta.images,
      qualityProfileId,
      rootFolderPath,
      monitored: true,
      minimumAvailability: collection.minimumAvailability ?? 'released',
      addOptions: { searchForMovie: search ?? collection.searchOnAdd ?? true, monitor: 'movieOnly' },
    } as Partial<RadarrMovie>;

    const movie = await client.addMovie(payload);

    // Adding a movie changes the library, its search index, and the collection's missing
    // count — invalidateTaggedLibrary drops the library + search + collections caches together.
    await invalidateTaggedLibrary('radarr', instanceId);

    logApiDuration('/api/radarr/collections', startedAt, { method: 'POST' });
    return NextResponse.json(movie);
  } catch (error) {
    logApiDuration('/api/radarr/collections', startedAt, { method: 'POST', failed: true });
    const message = error instanceof Error ? error.message : 'Failed to add movie';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Toggle monitoring on a single collection.
async function putHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('movies.editMonitoring');
  if (capError) return capError;
  const startedAt = performance.now();

  try {
    const body = await request.json();
    const instanceId = typeof body.instanceId === 'string' ? body.instanceId : undefined;
    const collectionId = Number(body.collectionId);
    if (!Number.isFinite(collectionId) || collectionId <= 0) {
      return NextResponse.json({ error: 'collectionId is required' }, { status: 400 });
    }
    // Require an explicit boolean — don't coerce (Boolean("false") would be true).
    if (typeof body.monitored !== 'boolean') {
      return NextResponse.json({ error: 'monitored (boolean) is required' }, { status: 400 });
    }
    const monitored: boolean = body.monitored;

    const client = await getRadarrClient(instanceId);
    await client.updateCollections({ collectionIds: [collectionId], monitored });

    // Toggling monitoring can cascade to the collection's movies on the Radarr side,
    // so drop the movie library (+ search index) along with the collections cache.
    await invalidateTaggedLibrary('radarr', instanceId);

    logApiDuration('/api/radarr/collections', startedAt, { method: 'PUT' });
    return NextResponse.json({ ok: true, collectionId, monitored });
  } catch (error) {
    logApiDuration('/api/radarr/collections', startedAt, { method: 'PUT', failed: true });
    const message = error instanceof Error ? error.message : 'Failed to update collection';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/collections');
export const POST = withApiLogging(postHandler, 'api/radarr/collections');
export const PUT = withApiLogging(putHandler, 'api/radarr/collections');
