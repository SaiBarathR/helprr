import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { qbittorrentInstanceOf } from '@/lib/server/qbittorrent-instance';
import { requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { readJsonBody } from '@/lib/bulk-editor';
import { logger } from '@/lib/logger';
import { bumpQbitCacheVersion } from '@/lib/cache/qbittorrent-version';
import { parseTags } from '@/lib/qbittorrent-inputs';
import type { QBittorrentTorrentInfo } from '@/types';

const ROUTE = '/api/qbittorrent/tags';

interface QBittorrentTagUsage {
  name: string;
  /** Torrents that have it: deleting the tag takes it off all of them. */
  torrents: number;
}

/** How many torrents have each tag (qBittorrent lists a torrent's tags as "a, b"). */
function countTagged(torrents: QBittorrentTorrentInfo[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const torrent of torrents) {
    for (const tag of (torrent.tags ?? '').split(',')) {
      const name = tag.trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

// Like categories, tag changes have no kind in the operation audit (adding one
// needs a migration): the log keeps who did what.
function logChange(user: User, message: string, details: Record<string, unknown>) {
  logger.info(message, { userId: user.id, username: user.username, ...details }, { scope: 'qbittorrent' });
}

/** The Tags screen: every tag, and the torrents that have it. */
async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  const instance = await qbittorrentInstanceOf(request);
  if (!instance.ok) return instance.response;
  const startedAt = performance.now();

  try {
    const client = await getQBittorrentClient(instance.instanceId);
    const [tags, torrents] = await Promise.all([client.getTags(), client.getTorrents()]);
    const counts = countTagged(torrents);
    // Rebuilt from names only: nothing else about the torrents goes to the browser.
    const usage: QBittorrentTagUsage[] = tags
      .filter((name): name is string => typeof name === 'string')
      .map((name) => ({ name, torrents: counts.get(name) ?? 0 }));
    logApiDuration(ROUTE, startedAt, { method: 'GET' });
    return NextResponse.json({ tags: usage });
  } catch (error) {
    logApiDuration(ROUTE, startedAt, { method: 'GET', failed: true });
    return upstreamErrorResponse(error, 'Failed to fetch tags');
  }
}

/**
 * Tags are labels only: unlike a category, a tag sets no folder, so making or
 * deleting one is torrent management (the grant that already adds and removes
 * tags on torrents), not an admin's job.
 */
async function postHandler(request: NextRequest) {
  const auth = await requireUserCapability('torrents.manage');
  if (!auth.ok) return auth.response;
  const instance = await qbittorrentInstanceOf(request);
  if (!instance.ok) return instance.response;
  const startedAt = performance.now();

  try {
    const json = await readJsonBody(request);
    if (!json.ok || !json.body || typeof json.body !== 'object') return badRequest('Malformed JSON');
    const body = json.body as Record<string, unknown>;
    const parsed = typeof body.name === 'string' ? parseTags([body.name]) : null;
    if (!parsed) return badRequest('A tag needs 1 to 100 characters and no comma');
    const [name] = parsed;

    const client = await getQBittorrentClient(instance.instanceId);
    if ((await client.getTags()).includes(name)) {
      return NextResponse.json({ error: `There is already a tag named ${name}` }, { status: 409 });
    }
    await client.createTags([name]);
    await bumpQbitCacheVersion(client.instanceId);
    logChange(auth.user, 'qBittorrent tag created', { tag: name });
    logApiDuration(ROUTE, startedAt, { method: 'POST' });
    return NextResponse.json({ success: true, name });
  } catch (error) {
    logApiDuration(ROUTE, startedAt, { method: 'POST', failed: true });
    return upstreamErrorResponse(error, 'Failed to create the tag');
  }
}

async function deleteHandler(request: NextRequest) {
  const auth = await requireUserCapability('torrents.manage');
  if (!auth.ok) return auth.response;
  const instance = await qbittorrentInstanceOf(request);
  if (!instance.ok) return instance.response;
  const startedAt = performance.now();

  try {
    const json = await readJsonBody(request);
    if (!json.ok || !json.body || typeof json.body !== 'object') return badRequest('Malformed JSON');
    const body = json.body as Record<string, unknown>;
    // parseTags: never an empty list, and no comma that would split one name into two tags.
    const names = parseTags(body.tags);
    if (!names) return badRequest('Choose 1 to 50 tags');

    const client = await getQBittorrentClient(instance.instanceId);
    const [tags, torrents] = await Promise.all([client.getTags(), client.getTorrents()]);
    const missing = names.filter((name) => !tags.includes(name));
    if (missing.length > 0) {
      return NextResponse.json({ error: `Not in qBittorrent: ${missing.join(', ')}` }, { status: 404 });
    }

    const counts = countTagged(torrents);
    await client.deleteTags(names);
    await bumpQbitCacheVersion(client.instanceId);
    logChange(auth.user, 'qBittorrent tags deleted', {
      tags: names,
      torrents: Object.fromEntries(names.map((name) => [name, counts.get(name) ?? 0])),
    });
    logApiDuration(ROUTE, startedAt, { method: 'DELETE', count: names.length });
    return NextResponse.json({ success: true });
  } catch (error) {
    logApiDuration(ROUTE, startedAt, { method: 'DELETE', failed: true });
    return upstreamErrorResponse(error, 'Failed to delete the tags');
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/tags');
export const POST = withApiLogging(postHandler, 'api/qbittorrent/tags');
export const DELETE = withApiLogging(deleteHandler, 'api/qbittorrent/tags');
