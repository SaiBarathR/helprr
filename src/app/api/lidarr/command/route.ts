import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Map an array to positive integers, returning null if any entry is invalid. */
function toPositiveIntArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: number[] = [];
  for (const entry of value) {
    const n = toPositiveInt(entry);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

async function postHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.manage');
  if (capError) return capError;

  try {
    const body = await request.json();
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);

    let result;
    switch (body.name) {
      case 'ArtistSearch': {
        // Bulk callers send `artistIds` (fanned out one search per id, since Lidarr
        // has no multi-artist search command); single-id callers keep `artistId`.
        if (body.artistIds !== undefined) {
          const artistIds = toPositiveIntArray(body.artistIds);
          if (artistIds === null) {
            return NextResponse.json({ error: 'artistIds must be a non-empty array of positive integers' }, { status: 400 });
          }
          // Fan out in bounded batches so selecting a large library doesn't fire
          // hundreds of concurrent searches at the Lidarr instance at once.
          const searched: unknown[] = [];
          for (let i = 0; i < artistIds.length; i += 5) {
            searched.push(...(await Promise.all(artistIds.slice(i, i + 5).map((id) => client.searchArtist(id)))));
          }
          result = searched;
        } else {
          const artistId = toPositiveInt(body.artistId);
          if (artistId === null) {
            return NextResponse.json({ error: 'artistId must be a positive integer' }, { status: 400 });
          }
          result = await client.searchArtist(artistId);
        }
        break;
      }
      case 'AlbumSearch': {
        const albumIds = toPositiveIntArray(body.albumIds);
        if (albumIds === null) {
          return NextResponse.json({ error: 'albumIds must be a non-empty array of positive integers' }, { status: 400 });
        }
        result = await client.searchAlbums(albumIds);
        break;
      }
      case 'RefreshArtist': {
        const artistId = toPositiveInt(body.artistId);
        if (artistId === null) {
          return NextResponse.json({ error: 'artistId must be a positive integer' }, { status: 400 });
        }
        result = await client.refreshArtist(artistId);
        break;
      }
      case 'RefreshMonitoredDownloads':
        result = await client.refreshMonitoredDownloads();
        break;
      case 'RenameFiles': {
        const artistId = toPositiveInt(body.artistId);
        if (artistId === null) {
          return NextResponse.json({ error: 'artistId must be a positive integer' }, { status: 400 });
        }
        const files = toPositiveIntArray(body.files);
        if (files === null) {
          return NextResponse.json({ error: 'files must be a non-empty array of positive integers' }, { status: 400 });
        }
        result = await client.renameArtistFiles(artistId, files);
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown command: ${body.name}` }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to execute command';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/lidarr/command');
