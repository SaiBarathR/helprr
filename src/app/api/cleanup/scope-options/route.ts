import { NextResponse } from 'next/server';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { torrentTags, trackerHostFromUrl } from '@/lib/cleanup/helpers';

async function getHandler() {
  const err = await requireAuth();
  if (err) return err;
  const capError = await requireCapability('cleanup.view');
  if (capError) return capError;

  const result: {
    qbitCategories: string[];
    qbitTags: string[];
    trackerDomains: string[];
  } = { qbitCategories: [], qbitTags: [], trackerDomains: [] };

  try {
    const qbit = await getQBittorrentClient();
    const [cats, torrents] = await Promise.all([
      qbit.getCategories().catch(() => ({})),
      qbit.getTorrents().catch(() => []),
    ]);
    result.qbitCategories = Object.keys(cats || {}).sort();
    const tagSet = new Set<string>();
    const domainSet = new Set<string>();
    for (const t of torrents) {
      for (const tg of torrentTags(t)) tagSet.add(tg);
      // torrents/info exposes the working tracker URL per torrent; the host
      // suffix is exactly what tracker-pattern and ignore fields match on.
      const host = t.tracker ? trackerHostFromUrl(t.tracker) : null;
      if (host) domainSet.add(host);
    }
    result.qbitTags = [...tagSet].sort();
    result.trackerDomains = [...domainSet].sort();
  } catch {
    /* qBit not configured */
  }

  return NextResponse.json(result);
}

export const GET = withApiLogging(getHandler, 'api/cleanup/scope-options');
