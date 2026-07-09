import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient, getLidarrClients } from '@/lib/service-helpers';
import { resolveConnection } from '@/lib/arr-instances';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';
import { LidarrClient } from '@/lib/lidarr-client';
import { requireAuth, requireCapability } from '@/lib/auth';
import type { LidarrArtist, LidarrArtistListItem } from '@/types';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { getCachedTaggedLibrary, invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { getInstanceLabelMaps, labelsFor } from '@/lib/cache/reference-labels';
import { etagJson } from '@/lib/etag-json';

const LIDARR_CACHE_HEADERS = {
  // Revalidate every read instead of replaying a stale copy: a browser cache is per-device
  // and can't be busted by a mutation (here or on another device), so max-age would keep
  // serving a deleted/added artist until it expires. The server answers fast from Redis.
  'Cache-Control': 'private, no-cache',
  // Partition the private cache by session cookie so a capability-gated response can't be
  // replayed from the browser cache to a different (or logged-out) user within the TTL.
  'Vary': 'Cookie',
} as const;

function toListItem(artist: LidarrArtist): LidarrArtistListItem {
  return {
    id: artist.id,
    artistName: artist.artistName,
    foreignArtistId: artist.foreignArtistId,
    sortName: artist.sortName,
    status: artist.status,
    ended: artist.ended,
    artistType: artist.artistType,
    disambiguation: artist.disambiguation,
    overview: artist.overview,
    images: artist.images.filter((img) => img.coverType === 'poster').slice(0, 1),
    genres: artist.genres,
    monitored: artist.monitored,
    qualityProfileId: artist.qualityProfileId,
    metadataProfileId: artist.metadataProfileId,
    ratings: artist.ratings,
    added: artist.added,
    statistics: artist.statistics,
    path: artist.path,
    tags: artist.tags,
    nextAlbum: artist.nextAlbum,
    lastAlbum: artist.lastAlbum,
  };
}

async function getHandler(request: NextRequest) {
  const startedAt = performance.now();
  const authError = await requireAuth();
  if (authError) {
    logApiDuration('GET /api/lidarr', startedAt, { method: 'GET', failed: true, authError: true });
    return authError;
  }
  const capError = await requireCapability('music.view');
  if (capError) {
    logApiDuration('GET /api/lidarr', startedAt, { method: 'GET', failed: true, authError: true });
    return capError;
  }

  try {
    const full = request.nextUrl.searchParams.get('full') === 'true';
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const cacheKeySeed = instanceId ?? 'all';

    // Resolve connections lazily and at most once (mirrors radarr/sonarr): a slim
    // cache hit or ?full=true that never needs labels does zero DB/client work.
    let instancesPromise:
      | Promise<{ connection: { id: string; label: string }; client: LidarrClient }[]>
      | undefined;
    const resolveInstances = () =>
      (instancesPromise ??= instanceId
        ? resolveConnection('LIDARR', instanceId).then((conn) => [
            { connection: conn, client: new LidarrClient(conn.url, conn.apiKey, getConnectionHeaders(conn)) },
          ])
        : getLidarrClients());

    // Shared tagged-library cache: one Redis entry per (scope, instance), reused by
    // ?full=true and the slim list. A partial (some-instance-failed) poll is left
    // uncached, so a blip can't half-blank the library for the whole TTL — matching
    // sonarr/radarr instead of the old swallow-to-[] aggregation.
    const { items: tagged, cached } = await getCachedTaggedLibrary({
      scope: 'lidarr',
      cacheKeySeed,
      getInstances: resolveInstances,
      fetchOne: (client) => client.getArtists(),
    });

    logApiDuration('GET /api/lidarr', startedAt, { method: 'GET', full, artistCount: tagged.length, cached: !!cached });
    if (full) return etagJson(request, tagged, LIDARR_CACHE_HEADERS);

    // Resolve quality-profile / metadata-profile / tag IDs to names against each item's OWN
    // instance, so an artist from a non-default Lidarr isn't mislabelled by the default lookup.
    const labelMaps = await getInstanceLabelMaps('lidarr', await resolveInstances());
    return etagJson(
      request,
      tagged.map((a) => ({
        ...toListItem(a),
        instanceId: a.instanceId,
        instanceLabel: a.instanceLabel,
        ...labelsFor(labelMaps, a.instanceId, {
          qualityProfileId: a.qualityProfileId,
          metadataProfileId: a.metadataProfileId,
          tags: a.tags,
        }),
      })),
      LIDARR_CACHE_HEADERS,
    );
  } catch (error) {
    logApiDuration('GET /api/lidarr', startedAt, { method: 'GET', failed: true });
    console.error('Failed to fetch artists:', error);
    return NextResponse.json({ error: 'Failed to fetch artists' }, { status: 500 });
  }
}

async function postHandler(request: Request) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('music.add');
  if (capError) return capError;

  try {
    const body = await request.json();
    const instanceId = typeof body.instanceId === 'string' ? body.instanceId : undefined;
    const client = await getLidarrClient(instanceId);
    const result = await client.addArtist(body);
    await invalidateTaggedLibrary('lidarr', instanceId);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to add artist:', error);
    return NextResponse.json({ error: 'Failed to add artist' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr');
export const POST = withApiLogging(postHandler, 'api/lidarr');
