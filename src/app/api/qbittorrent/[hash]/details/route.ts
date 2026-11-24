import { NextRequest, NextResponse } from 'next/server';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { logApiDuration } from '@/lib/server-perf';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { magnetForViewer, seesTrackerUrls, trackersForViewer } from '@/lib/qbittorrent-tracker-links';

// A v1 info hash (SHA-1) or a v2 one (SHA-256), in hex: not qBittorrent's `all` or a `|` list.
const SINGLE_TORRENT_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

// The properties the detail drawer shows. The rest stay on the server: the
// torrent's comment, for one, is free text a tracker can put a link in.
const PROPERTY_FIELDS = [
  'save_path', 'total_size', 'total_downloaded', 'total_uploaded', 'total_wasted', 'share_ratio',
  'dl_speed', 'up_speed', 'dl_limit', 'up_limit', 'time_elapsed', 'seeding_time', 'addition_date',
  'completion_date', 'seeds', 'seeds_total', 'peers', 'peers_total', 'nb_connections',
] as const;

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const auth = await requireUserCapability('torrents.view');
  if (!auth.ok) return auth.response;
  const startedAt = performance.now();

  try {
    const { hash } = await params;
    if (!SINGLE_TORRENT_HASH.test(hash)) {
      return NextResponse.json({ error: 'Invalid torrent hash' }, { status: 400 });
    }
    const client = await getQBittorrentClient();

    const [properties, files, trackers, listed] = await Promise.all([
      client.getTorrentProperties(hash, request.signal),
      client.getTorrentFiles(hash, request.signal),
      client.getTorrentTrackers(hash, request.signal),
      // For the magnet, which torrents/properties does not include. Without it the
      // details still show; only Copy Magnet URI is missing.
      client.getTorrents(undefined, undefined, undefined, undefined, hash, request.signal).catch(() => []),
    ]);

    // Announce URLs carry a private tracker's passkey: in full for an admin only.
    const fullUrls = seesTrackerUrls(auth.user);
    const torrent = listed.find((entry) => entry.hash.toLowerCase() === hash.toLowerCase());
    const shownProperties: Record<string, unknown> = {};
    for (const field of PROPERTY_FIELDS) shownProperties[field] = properties[field];

    logApiDuration('/api/qbittorrent/[hash]/details', startedAt, {
      method: 'GET',
      fileCount: files.length,
      trackerCount: trackers.length,
    });
    return NextResponse.json({
      properties: shownProperties,
      files,
      trackers: trackersForViewer(trackers, fullUrls),
      magnet: magnetForViewer(torrent?.magnet_uri, fullUrls),
    });
  } catch (error) {
    logApiDuration('/api/qbittorrent/[hash]/details', startedAt, { method: 'GET', failed: true });
    return upstreamErrorResponse(error, 'Failed to fetch torrent details');
  }
}

export const GET = withApiLogging(getHandler, 'api/qbittorrent/[hash]/details');
