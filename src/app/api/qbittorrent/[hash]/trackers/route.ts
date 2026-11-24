import { NextRequest, NextResponse } from 'next/server';
import { isAxiosError } from 'axios';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { bumpQbitCacheVersion } from '@/lib/cache/qbittorrent-version';
import { upstreamErrorResponse } from '@/lib/api-error';
import { seesTrackerUrls, trackersForViewer } from '@/lib/qbittorrent-tracker-links';
import { parseTrackerRef, parseTrackerUrl, parseTrackerUrls, resolveTracker, trackerUrlError } from '@/lib/qbittorrent-tracker-edits';

// A v1 info hash (SHA-1) or a v2 one (SHA-256), in hex: not qBittorrent's `all` or a `|` list.
const SINGLE_TORRENT_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

const LIST_CHANGED = 'The tracker list changed. Check it and try again.';

/*
 * Add, edit or remove one torrent's trackers, under torrents.manage like its
 * other settings (a private torrent's: an admin's only, see below). Edits and removals name the tracker by its place in the list
 * (see qbittorrent-tracker-edits.ts), so a user who is not an admin can change
 * a private tracker without ever being sent its passkey; the answer is the new
 * list as this user may see it. Not operation-audited: like tags, location and
 * rename, a tracker change deletes nothing (the audit covers torrent deletes).
 */
async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const auth = await requireUserCapability('torrents.manage');
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();
  let action: unknown;

  const refuse = (status: number, error: string, reason: string) => {
    logApiDuration('/api/qbittorrent/[hash]/trackers', startedAt, { method: 'POST', action, refused: reason });
    return NextResponse.json({ error }, { status });
  };

  try {
    const { hash } = await params;
    if (!SINGLE_TORRENT_HASH.test(hash)) return refuse(400, 'Invalid torrent hash', 'hash');
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return refuse(400, 'malformed JSON', 'json');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'malformed JSON', 'json');
    const input = body as Record<string, unknown>;
    if (input.action !== 'add' && input.action !== 'edit' && input.action !== 'remove') return refuse(400, 'Unknown action', 'action');
    // Logged once known to be one of these.
    action = input.action;

    const fullUrls = seesTrackerUrls(auth.user);
    const client = await getQBittorrentClient();
    let count: number;

    // A private torrent's trackers are the owner's tracker account: a third-party
    // tracker added to it leaks the torrent (private trackers ban for that), and a
    // removed or replaced passkey tracker stops seeding until an admin, the only
    // one who can see the URL, puts it back. So they are an admin's to change.
    // When qBittorrent doesn't say (4.x has no `private` field), it counts as private.
    if (!fullUrls) {
      const [info] = await client.getTorrents(undefined, undefined, undefined, undefined, hash, request.signal);
      if (!info) return refuse(404, 'Torrent not found', 'missing');
      if (info.private !== false) return refuse(403, 'Only an admin can change a private torrent’s trackers', 'private');
    }

    if (action === 'add') {
      const parsed = parseTrackerUrls(input.urls);
      if (!parsed.ok) return refuse(400, parsed.error, 'url');
      await client.addTrackers(hash, parsed.urls);
      count = parsed.urls.length;
    } else {
      const ref = parseTrackerRef(input);
      if (!ref) return refuse(400, 'Name a tracker by its place in the list', 'ref');
      const newUrl = action === 'edit' ? parseTrackerUrl(input.url) : null;
      if (action === 'edit' && !newUrl) return refuse(400, trackerUrlError(null), 'url');

      const tracker = resolveTracker(await client.getTorrentTrackers(hash), ref, fullUrls);
      if (!tracker.ok) {
        return tracker.reason === 'pseudo'
          ? refuse(400, 'DHT, PeX and LSD are not trackers you can change', 'pseudo')
          : refuse(409, LIST_CHANGED, 'changed');
      }

      if (newUrl) {
        try {
          await client.editTracker(hash, tracker.url, newUrl);
        } catch (error) {
          // 409: the old URL is gone (changed meanwhile) or the new one is already listed.
          if (!isAxiosError(error) || error.response?.status !== 409) throw error;
          const notFound = /not found/i.test(String(error.response.data ?? ''));
          return refuse(409, notFound ? LIST_CHANGED : 'That tracker is already on this torrent', notFound ? 'changed' : 'exists');
        }
      } else {
        // removeTrackers splits on `|`: such a URL would be read as other trackers' URLs.
        if (tracker.url.includes('|')) return refuse(409, 'qBittorrent can’t remove a tracker whose URL has a | in it', 'pipe');
        await client.removeTrackers(hash, [tracker.url]);
      }
      count = 1;
    }

    // Let the list's next refetch see the change.
    await bumpQbitCacheVersion();
    // The change is made; without a fresh list the page reads the details again.
    const after = await client.getTorrentTrackers(hash, request.signal).catch(() => null);
    logApiDuration('/api/qbittorrent/[hash]/trackers', startedAt, { method: 'POST', action, trackerCount: count });
    return NextResponse.json({ trackers: after ? trackersForViewer(after, fullUrls) : null });
  } catch (error) {
    logApiDuration('/api/qbittorrent/[hash]/trackers', startedAt, { method: 'POST', action, failed: true });
    return upstreamErrorResponse(error, 'Failed to change trackers');
  }
}

// A new announce URL carries its passkey: never in the failed-request body log.
export const POST = withApiLogging(postHandler, 'api/qbittorrent/[hash]/trackers', { logBodies: false });
