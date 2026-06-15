import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import type { ResolvedLabels } from '@/types';

// Per-instance lookups for resolving an *arr item's instance-local reference IDs
// (quality profile / tag / metadata profile) to display names. List routes aggregate
// items from every connected instance, so each item must be labelled against ITS OWN
// instance — resolving against a single (default) instance mislabels every other row.
//
// Reference data changes far less often than the library, so it gets its own longer
// TTL and Redis entry (keyed per instance) rather than riding the 120s library cache.
// Best-effort: a failed instance yields empty maps (labels fall back to undefined,
// same as an un-enriched row) instead of failing the whole list.

// Matches the 120s tagged-library TTL. A longer TTL here would let labels lag the
// library: after a bulk-tag edit (which can create a new tag id) the refreshed
// library shows the new id while a stale label map lacks its name, so the chip
// renders blank until the labels expire. Keeping the two TTLs equal means labels
// never go stale for longer than the library row that references them.
const REFERENCE_TTL_SECONDS = 120;

export interface InstanceLabelMaps {
  qualityProfile: Record<number, string>;
  tag: Record<number, string>;
  metadataProfile: Record<number, string>;
}

interface ReferenceClient {
  getQualityProfiles(): Promise<Array<{ id: number; name: string }>>;
  getTags(): Promise<Array<{ id: number; label: string }>>;
  getMetadataProfiles?(): Promise<Array<{ id: number; name: string }>>;
}

// Resolve one reference call independently so a single failing endpoint (e.g. a
// transient 500 from getMetadataProfiles) doesn't drop the other two label maps
// for the instance. `ok:false` means "don't cache" — a partial map would otherwise
// pin missing labels for the whole TTL.
async function settle<T>(p: Promise<T[]> | undefined): Promise<{ ok: boolean; data: T[] }> {
  if (!p) return { ok: true, data: [] };
  try {
    return { ok: true, data: await p };
  } catch {
    return { ok: false, data: [] };
  }
}

async function loadOne(scope: string, connectionId: string, client: ReferenceClient): Promise<InstanceLabelMaps> {
  const cached = await getCachedJson<InstanceLabelMaps>(`${scope}-labels`, connectionId);
  if (cached) return cached;

  const [profiles, tags, metadataProfiles] = await Promise.all([
    settle(client.getQualityProfiles()),
    settle(client.getTags()),
    settle(client.getMetadataProfiles?.()),
  ]);
  const maps: InstanceLabelMaps = {
    qualityProfile: Object.fromEntries(profiles.data.map((p) => [p.id, p.name])),
    tag: Object.fromEntries(tags.data.map((t) => [t.id, t.label])),
    metadataProfile: Object.fromEntries(metadataProfiles.data.map((m) => [m.id, m.name])),
  };
  // Only cache a fully-resolved map; if any call failed, serve what we have this
  // request but let the next one retry instead of caching the gap.
  if (profiles.ok && tags.ok && metadataProfiles.ok) {
    await setCachedJson(`${scope}-labels`, connectionId, maps, REFERENCE_TTL_SECONDS);
  }
  return maps;
}

/**
 * Resolve per-instance label maps for the given instances, keyed by connection id.
 * One Redis read (and, on a miss, two/three upstream reference calls) per instance.
 */
export async function getInstanceLabelMaps(
  scope: string,
  instances: Array<{ connection: { id: string }; client: ReferenceClient }>,
): Promise<Map<string, InstanceLabelMaps>> {
  const entries = await Promise.all(
    instances.map(async ({ connection, client }): Promise<[string, InstanceLabelMaps]> => [
      connection.id,
      await loadOne(scope, connection.id, client),
    ]),
  );
  return new Map(entries);
}

/** Resolve one item's instance-local reference IDs to display names against its own instance. */
export function labelsFor(
  maps: Map<string, InstanceLabelMaps>,
  instanceId: string | undefined,
  ids: { qualityProfileId?: number; metadataProfileId?: number; tags?: number[] },
): ResolvedLabels {
  const m = instanceId ? maps.get(instanceId) : undefined;
  return {
    qualityProfileName: ids.qualityProfileId != null ? m?.qualityProfile[ids.qualityProfileId] : undefined,
    metadataProfileName: ids.metadataProfileId != null ? m?.metadataProfile[ids.metadataProfileId] : undefined,
    tagLabels: ids.tags?.map((id) => m?.tag[id]).filter((label): label is string => Boolean(label)),
  };
}
