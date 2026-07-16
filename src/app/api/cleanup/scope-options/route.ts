import { NextResponse } from 'next/server';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getQBittorrentClient, getSonarrClients, getRadarrClients } from '@/lib/service-helpers';
import { torrentTags, trackerHostFromUrl } from '@/lib/cleanup/helpers';

// Union tags across every instance, deduped by label (tag ids are per-instance
// and not comparable; users pick tags by name and matching runs per-instance).
// Tags are fetched concurrently; an unreachable instance yields [] rather than
// failing the union, and Promise.all preserves array order so the first-seen
// label wins exactly as the serial version did.
async function unionTags(
  getClients: () => Promise<Array<{ client: { getTags(): Promise<{ id: number; label: string }[]> } }>>,
): Promise<{ id: number; label: string }[]> {
  const out: { id: number; label: string }[] = [];
  const seen = new Set<string>();
  try {
    const perInstance = await Promise.all(
      (await getClients()).map(({ client }) => client.getTags().catch(() => [])),
    );
    for (const tags of perInstance) {
      for (const t of tags) {
        if (!seen.has(t.label)) {
          seen.add(t.label);
          out.push({ id: t.id, label: t.label });
        }
      }
    }
  } catch {
    /* service not configured */
  }
  return out;
}

async function getHandler() {
  const err = await requireAuth();
  if (err) return err;
  const capError = await requireCapability('cleanup.view');
  if (capError) return capError;

  const result: {
    qbitCategories: string[];
    qbitTags: string[];
    trackerDomains: string[];
    sonarrTags: { id: number; label: string }[];
    radarrTags: { id: number; label: string }[];
  } = { qbitCategories: [], qbitTags: [], trackerDomains: [], sonarrTags: [], radarrTags: [] };

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

  result.sonarrTags = await unionTags(getSonarrClients);
  result.radarrTags = await unionTags(getRadarrClients);

  return NextResponse.json(result);
}

export const GET = withApiLogging(getHandler, 'api/cleanup/scope-options');
