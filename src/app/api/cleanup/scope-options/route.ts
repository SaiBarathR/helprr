import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getQBittorrentClient, getSonarrClient, getRadarrClient } from '@/lib/service-helpers';
import { torrentTags } from '@/lib/cleanup/helpers';

async function getHandler() {
  const err = await requireAuth();
  if (err) return err;

  const result: {
    qbitCategories: string[];
    qbitTags: string[];
    sonarrTags: { id: number; label: string }[];
    radarrTags: { id: number; label: string }[];
  } = { qbitCategories: [], qbitTags: [], sonarrTags: [], radarrTags: [] };

  try {
    const qbit = await getQBittorrentClient();
    const [cats, torrents] = await Promise.all([
      qbit.getCategories().catch(() => ({})),
      qbit.getTorrents().catch(() => []),
    ]);
    result.qbitCategories = Object.keys(cats || {}).sort();
    const tagSet = new Set<string>();
    for (const t of torrents) {
      for (const tg of torrentTags(t)) tagSet.add(tg);
    }
    result.qbitTags = [...tagSet].sort();
  } catch {
    /* qBit not configured */
  }

  try {
    const c = await getSonarrClient();
    const tags = await c.getTags();
    result.sonarrTags = tags.map((t) => ({ id: t.id, label: t.label }));
  } catch {
    /* Sonarr not configured */
  }

  try {
    const c = await getRadarrClient();
    const tags = await c.getTags();
    result.radarrTags = tags.map((t) => ({ id: t.id, label: t.label }));
  } catch {
    /* Radarr not configured */
  }

  return NextResponse.json(result);
}

export const GET = withApiLogging(getHandler, 'api/cleanup/scope-options');
