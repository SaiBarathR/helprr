import { NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler(request: Request) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.manage');
  if (capError) return capError;

  try {
    const body = await request.json();
    const client = await getLidarrClient();

    let result;
    switch (body.name) {
      case 'ArtistSearch':
        result = await client.searchArtist(body.artistId);
        break;
      case 'AlbumSearch':
        if (!Array.isArray(body.albumIds) || body.albumIds.length === 0) {
          return NextResponse.json({ error: 'albumIds must be a non-empty array' }, { status: 400 });
        }
        result = await client.searchAlbums(body.albumIds);
        break;
      case 'RefreshArtist':
        result = await client.refreshArtist(body.artistId);
        break;
      case 'RefreshMonitoredDownloads':
        result = await client.refreshMonitoredDownloads();
        break;
      case 'RenameFiles':
        result = await client.renameArtistFiles(body.artistId, body.files);
        break;
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
