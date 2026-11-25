import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getQBittorrentClients } from '@/lib/service-helpers';
import { torrentTags, trackerHostFromUrl } from '@/lib/cleanup/helpers';

async function getHandler() {
  const auth = await requireUserCapability('cleanup.view');
  if (!auth.ok) return auth.response;

  const result: {
    qbitCategories: string[];
    qbitTags: string[];
    trackerDomains: string[];
  } = { qbitCategories: [], qbitTags: [], trackerDomains: [] };

  try {
    // The cleaners act on every qBittorrent, so a rule may name what any of them has.
    const read = await Promise.all((await getQBittorrentClients()).map(({ client }) => Promise.all([
      client.getCategories().catch(() => ({})),
      client.getTorrents().catch(() => []),
    ])));
    const categorySet = new Set<string>();
    const tagSet = new Set<string>();
    const domainSet = new Set<string>();
    for (const [cats, torrents] of read) {
      for (const name of Object.keys(cats || {})) categorySet.add(name);
      for (const t of torrents) {
        for (const tg of torrentTags(t)) tagSet.add(tg);
        // torrents/info exposes the working tracker URL per torrent; the host
        // suffix is exactly what tracker-pattern and ignore fields match on.
        const host = t.tracker ? trackerHostFromUrl(t.tracker) : null;
        if (host) domainSet.add(host);
      }
    }
    result.qbitCategories = [...categorySet].sort();
    result.qbitTags = [...tagSet].sort();
    result.trackerDomains = [...domainSet].sort();
  } catch {
    /* qBit not configured */
  }

  return NextResponse.json(result);
}

export const GET = withApiLogging(getHandler, 'api/cleanup/scope-options');
