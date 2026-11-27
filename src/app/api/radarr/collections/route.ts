import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient, getRadarrClients } from '@/lib/service-helpers';
import { resolveConnection } from '@/lib/arr-instances';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';
import { RadarrClient } from '@/lib/radarr-client';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';
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
import { upstreamErrorResponse } from '@/lib/api-error';
import { sameFolder } from '@/lib/paths';

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
    qualityProfileId: collection.qualityProfileId,
    rootFolderPath: collection.rootFolderPath,
    minimumAvailability: collection.minimumAvailability,
    searchOnAdd: collection.searchOnAdd,
    tags: collection.tags,
    instanceId: collection.instanceId,
    instanceLabel: collection.instanceLabel,
  };
}

async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('movies.view');
  if (!auth.ok) return auth.response;
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
            { connection: conn, client: new RadarrClient(conn.url, conn.apiKey, getConnectionHeaders(conn)) },
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
    return upstreamErrorResponse(error, 'Failed to fetch collections');
  }
}

// Add a missing movie from a collection, applying that collection's own defaults
// (quality profile / root folder / minimum availability / search / tags) the way Radarr does.
async function postHandler(request: NextRequest) {
  const auth = await requireUserCapability('movies.add');
  if (!auth.ok) return auth.response;
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
      tags: collection.tags ?? [],
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
    return upstreamErrorResponse(error, 'Failed to add movie');
  }
}

const MINIMUM_AVAILABILITY = ['announced', 'inCinemas', 'released'] as const;

// The fields the drawer's monitoring switch and Edit collection send, each with the
// capability a movie edit needs for the same change. null = admin only: no capability
// covers a movie's quality profile or availability, and searchOnAdd starts searches.
const COLLECTION_FIELD_CAPABILITY = {
  monitored: 'movies.editMonitoring',
  monitorMovies: 'movies.editMonitoring',
  tags: 'movies.editTags',
  rootFolderPath: 'movies.changePath',
  qualityProfileId: null,
  minimumAvailability: null,
  searchOnAdd: null,
} as const satisfies Record<string, Capability | null>;

type CollectionField = keyof typeof COLLECTION_FIELD_CAPABILITY;

interface CollectionEdit {
  monitored?: boolean;
  monitorMovies?: boolean;
  searchOnAdd?: boolean;
  qualityProfileId?: number;
  rootFolderPath?: string;
  minimumAvailability?: (typeof MINIMUM_AVAILABILITY)[number];
  tags?: number[];
}

/** The body's collection fields, shape-checked, or the 400 message for the first bad one. */
function parseCollectionEdit(body: Record<string, unknown>): { edit: CollectionEdit } | { error: string } {
  const edit: CollectionEdit = {};
  for (const key of ['monitored', 'monitorMovies', 'searchOnAdd'] as const) {
    if (body[key] === undefined) continue;
    // Require an explicit boolean — don't coerce (Boolean("false") would be true).
    if (typeof body[key] !== 'boolean') return { error: `${key} must be a boolean` };
    edit[key] = body[key];
  }
  if (body.qualityProfileId !== undefined) {
    const id = body.qualityProfileId;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return { error: 'qualityProfileId must be a positive integer' };
    edit.qualityProfileId = id;
  }
  if (body.rootFolderPath !== undefined) {
    if (typeof body.rootFolderPath !== 'string' || !body.rootFolderPath) return { error: 'rootFolderPath must be a path' };
    edit.rootFolderPath = body.rootFolderPath;
  }
  if (body.minimumAvailability !== undefined) {
    const value = body.minimumAvailability;
    if (!MINIMUM_AVAILABILITY.includes(value as never)) return { error: 'minimumAvailability must be announced, inCinemas or released' };
    edit.minimumAvailability = value as CollectionEdit['minimumAvailability'];
  }
  if (body.tags !== undefined) {
    const tags = body.tags;
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'number' && Number.isInteger(t) && t > 0)) {
      return { error: 'tags must be a list of tag ids' };
    }
    edit.tags = [...new Set(tags as number[])];
  }
  return { edit };
}

// Monitoring, and the options Radarr applies when it adds the collection's movies.
// Only the fields sent change; each needs its own capability (COLLECTION_FIELD_CAPABILITY).
async function putHandler(request: NextRequest) {
  const auth = await requireUserCapability('movies.view');
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    const instanceId = typeof body.instanceId === 'string' ? body.instanceId : undefined;
    const collectionId = Number(body.collectionId);
    if (!Number.isInteger(collectionId) || collectionId <= 0) {
      return NextResponse.json({ error: 'collectionId is required' }, { status: 400 });
    }
    const parsed = parseCollectionEdit(body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const edit = parsed.edit;
    const fields = Object.keys(edit) as CollectionField[];
    if (fields.length === 0) {
      return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
    }

    if (auth.user.role !== 'admin') {
      if (fields.some((field) => COLLECTION_FIELD_CAPABILITY[field] === null)) {
        return NextResponse.json({ error: 'Forbidden: only an admin can change these fields' }, { status: 403 });
      }
      const missing = [...new Set(fields.map((field) => COLLECTION_FIELD_CAPABILITY[field]))]
        .filter((cap) => cap !== null && !can(auth.user, cap));
      if (missing.length > 0) {
        return NextResponse.json({ error: `Forbidden: you cannot change ${missing.join(', ')}` }, { status: 403 });
      }
      // Radarr adds a monitored collection's missing movies (and may search for
      // them) on its next refresh: turning monitoring on is adding movies.
      if (edit.monitored === true && !can(auth.user, 'movies.add')) {
        return NextResponse.json({ error: 'Forbidden: monitoring a collection adds its missing movies, which needs movies.add' }, { status: 403 });
      }
    }

    const client = await getRadarrClient(instanceId);

    // Ids and folders are the instance's own, so an edit can't point the collection at
    // a profile, folder or tag that isn't there.
    const [profiles, folders, tags] = await Promise.all([
      edit.qualityProfileId !== undefined ? client.getQualityProfiles() : null,
      edit.rootFolderPath !== undefined ? client.getRootFolders() : null,
      edit.tags?.length ? client.getTags() : null,
    ]);
    if (profiles && !profiles.some((p) => p.id === edit.qualityProfileId)) {
      return NextResponse.json({ error: 'Unknown quality profile' }, { status: 400 });
    }
    if (folders) {
      const folder = folders.find((f) => sameFolder(f.path, edit.rootFolderPath!));
      if (!folder) return NextResponse.json({ error: 'rootFolderPath must be one of this instance’s root folders' }, { status: 400 });
      edit.rootFolderPath = folder.path;
    }
    if (tags && !edit.tags!.every((id) => tags.some((t) => t.id === id))) {
      return NextResponse.json({ error: 'Unknown tag' }, { status: 400 });
    }

    const { tags: nextTags, ...bulk } = edit;
    try {
      if (Object.keys(bulk).length > 0) {
        await client.updateCollections({ collectionIds: [collectionId], ...bulk });
      }
      // Radarr's bulk update has no tags field; the single-collection PUT does.
      if (nextTags !== undefined) {
        const current = await client.getCollection(collectionId);
        await client.updateCollection({ ...current, tags: nextTags });
      }
    } finally {
      // Monitoring can cascade to the collection's movies on the Radarr side, so drop the
      // movie library (+ search index) along with the collections cache, also after a
      // tags write that failed once the bulk fields were saved.
      await invalidateTaggedLibrary('radarr', instanceId);
    }

    logApiDuration('/api/radarr/collections', startedAt, { method: 'PUT' });
    return NextResponse.json({ ok: true, collectionId, ...edit });
  } catch (error) {
    logApiDuration('/api/radarr/collections', startedAt, { method: 'PUT', failed: true });
    return upstreamErrorResponse(error, 'Failed to update collection');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/collections');
export const POST = withApiLogging(postHandler, 'api/radarr/collections');
export const PUT = withApiLogging(putHandler, 'api/radarr/collections');
