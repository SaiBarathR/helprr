import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import type { LidarrArtist, LidarrArtistListItem } from '@/types';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';

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
    const client = await getLidarrClient();
    const artists = await client.getArtists();
    logApiDuration('GET /api/lidarr', startedAt, { method: 'GET', full, artistCount: artists.length });
    return NextResponse.json(full ? artists : artists.map(toListItem));
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
    const client = await getLidarrClient();
    const result = await client.addArtist(body);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to add artist:', error);
    return NextResponse.json({ error: 'Failed to add artist' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr');
export const POST = withApiLogging(postHandler, 'api/lidarr');
