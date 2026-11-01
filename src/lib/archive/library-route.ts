import { NextRequest, NextResponse } from 'next/server';
import { archiveLibraryOptions, readLibraryStatus } from '@/lib/archive/library';
import { getJellyfinClient } from '@/lib/service-helpers';

/** What the library section shows. Each route checks its own capability first. */
export async function libraryStatusResponse(path: string | null): Promise<NextResponse> {
  if (!path) return NextResponse.json({ configured: false });
  try {
    const client = await getJellyfinClient();
    return NextResponse.json({ configured: true, path, ...(await readLibraryStatus(client, path)) });
  } catch {
    return NextResponse.json({ error: 'Could not reach Jellyfin' }, { status: 502 });
  }
}

/** Creates the library on the real Jellyfin, or links one that already points at this path. */
export async function linkLibrary(
  request: NextRequest,
  save: (data: { jellyfinLibraryPath: string; jellyfinLibraryItemId: string | null }) => Promise<void>,
): Promise<NextResponse> {
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
      await client.addVirtualFolder(name, 'tvshows', archiveLibraryOptions(path));
      status = await readLibraryStatus(client, path);
    }
    await save({ jellyfinLibraryPath: path, jellyfinLibraryItemId: status.itemId });
    return NextResponse.json({ configured: true, path, ...status });
  } catch {
    return NextResponse.json({ error: 'Jellyfin refused the library' }, { status: 502 });
  }
}
