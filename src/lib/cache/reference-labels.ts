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

const REFERENCE_TTL_SECONDS = 600;

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

const EMPTY_MAPS: InstanceLabelMaps = { qualityProfile: {}, tag: {}, metadataProfile: {} };

async function loadOne(scope: string, connectionId: string, client: ReferenceClient): Promise<InstanceLabelMaps> {
  const cached = await getCachedJson<InstanceLabelMaps>(`${scope}-labels`, connectionId);
  if (cached) return cached;

  try {
    const [profiles, tags, metadataProfiles] = await Promise.all([
      client.getQualityProfiles(),
      client.getTags(),
      client.getMetadataProfiles?.() ?? Promise.resolve([]),
    ]);
    const maps: InstanceLabelMaps = {
      qualityProfile: Object.fromEntries(profiles.map((p) => [p.id, p.name])),
      tag: Object.fromEntries(tags.map((t) => [t.id, t.label])),
      metadataProfile: Object.fromEntries(metadataProfiles.map((m) => [m.id, m.name])),
    };
    await setCachedJson(`${scope}-labels`, connectionId, maps, REFERENCE_TTL_SECONDS);
    return maps;
  } catch {
    return EMPTY_MAPS;
  }
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
