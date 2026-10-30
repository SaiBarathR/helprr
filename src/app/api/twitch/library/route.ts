import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { getJellyfinClient } from '@/lib/service-helpers';
import { readLibraryStatus, twitchLibraryOptions } from '@/lib/twitch/library';
import { getTwitchSettings } from '@/lib/twitch/settings';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const { jellyfinLibraryPath } = await getTwitchSettings();
  if (!jellyfinLibraryPath) return NextResponse.json({ configured: false });
  try {
    const client = await getJellyfinClient();
    return NextResponse.json({ configured: true, path: jellyfinLibraryPath, ...(await readLibraryStatus(client, jellyfinLibraryPath)) });
  } catch {
    return NextResponse.json({ error: 'Could not reach Jellyfin' }, { status: 502 });
  }
}

/** Creates the library on the real Jellyfin, or links one that already points at this path. */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { name?: unknown; path?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const path = typeof body?.path === 'string' ? body.path.trim() : '';
  if (!/^[\w ()-]{1,64}$/.test(name) || !path.startsWith('/') || path.includes('..')) {
    return NextResponse.json({ error: 'Enter a library name and an absolute path' }, { status: 400 });
  }

  try {
    const client = await getJellyfinClient();
    let status = await readLibraryStatus(client, path);
    if (status.conflicts.length > 0) {
      return NextResponse.json({ error: `Already covered by ${status.conflicts.join(', ')}` }, { status: 409 });
    }
    if (!status.exists) {
      await client.addVirtualFolder(name, 'tvshows', twitchLibraryOptions(path));
      status = await readLibraryStatus(client, path);
    }
    await getTwitchSettings();
    await prisma.twitchSettings.update({
      where: { id: 'singleton' },
      data: { jellyfinLibraryPath: path, jellyfinLibraryItemId: status.itemId },
    });
    return NextResponse.json({ configured: true, path, ...status });
  } catch {
    return NextResponse.json({ error: 'Jellyfin refused the library' }, { status: 502 });
  }
}

export const GET = withApiLogging(getHandler, 'api/twitch/library');
export const POST = withApiLogging(postHandler, 'api/twitch/library');
