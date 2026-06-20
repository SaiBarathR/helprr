import { NextResponse } from 'next/server';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getQBittorrentClient, getSonarrClients, getRadarrClients } from '@/lib/service-helpers';
import { torrentTags } from '@/lib/cleanup/helpers';

async function getHandler() {
  const err = await requireAuth();
  if (err) return err;
  const capError = await requireCapability('cleanup.view');
  if (capError) return capError;

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

  // Union tags across every instance, deduped by label (tag ids are per-instance
  // and not comparable; users pick tags by name and matching runs per-instance).
  try {
    const seen = new Set<string>();
    // Fetch every instance's tags concurrently; an unreachable instance yields []
    // rather than failing the union. Array order is preserved so first-seen label
    // wins exactly as the serial version did.
    const perInstance = await Promise.all(
      (await getSonarrClients()).map(({ client }) => client.getTags().catch(() => [])),
    );
    for (const tags of perInstance) {
      for (const t of tags) {
        if (!seen.has(t.label)) {
          seen.add(t.label);
          result.sonarrTags.push({ id: t.id, label: t.label });
        }
      }
    }
  } catch {
    /* Sonarr not configured */
  }

  try {
    const seen = new Set<string>();
    const perInstance = await Promise.all(
      (await getRadarrClients()).map(({ client }) => client.getTags().catch(() => [])),
    );
    for (const tags of perInstance) {
      for (const t of tags) {
        if (!seen.has(t.label)) {
          seen.add(t.label);
          result.radarrTags.push({ id: t.id, label: t.label });
        }
      }
    }
  } catch {
    /* Radarr not configured */
  }

  return NextResponse.json(result);
}

export const GET = withApiLogging(getHandler, 'api/cleanup/scope-options');
