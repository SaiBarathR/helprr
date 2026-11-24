import { NextResponse } from 'next/server';
import { resolveConnection, type ArrServiceType } from '@/lib/arr-instances';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';
import { SonarrClient } from '@/lib/sonarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { LidarrClient } from '@/lib/lidarr-client';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import { REFERENCE_CACHE_HEADERS } from '@/lib/cache/reference-headers';
import { upstreamErrorResponse } from '@/lib/api-error';
import type { QualityProfileItemResource, QualityProfileResource, QualityProfileSummary } from '@/types';

// The same 120s as the reference-label maps: a profile edited in the *arr app
// shows here within two minutes, and the sheet doesn't re-read it on every tap.
const PROFILE_TTL_SECONDS = 120;

function itemName(item: QualityProfileItemResource): string {
  return item.quality?.name ?? item.name ?? 'Unknown';
}

function itemId(item: QualityProfileItemResource): number | undefined {
  return item.quality?.id ?? item.id;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The sheet's view of a profile, rebuilt field by field so nothing else the
 * resource carries reaches the browser. Qualities are reversed into the order
 * the *arr apps list them (most preferred first) and only allowed ones are kept.
 */
export function summarizeQualityProfile(profile: QualityProfileResource): QualityProfileSummary {
  let cutoff: string | null = null;
  const qualities: QualityProfileSummary['qualities'] = [];
  for (const item of [...(profile.items ?? [])].reverse()) {
    const isCutoff = itemId(item) === profile.cutoff;
    if (isCutoff) cutoff = itemName(item);
    if (!item.allowed) continue;
    const members = (item.items ?? [])
      .filter((member) => member.allowed)
      .reverse()
      .map(itemName);
    qualities.push({ name: itemName(item), isCutoff, members });
  }

  const formats = (profile.formatItems ?? [])
    .filter((entry) => typeof entry.score === 'number' && Number.isFinite(entry.score))
    .map((entry) => ({ name: entry.name || `Format ${entry.format}`, score: entry.score }))
    .sort((a, b) => {
      // Non-zero scores first (highest first), then the zero ones by name.
      if ((a.score === 0) !== (b.score === 0)) return a.score === 0 ? 1 : -1;
      return b.score - a.score || a.name.localeCompare(b.name);
    });

  return {
    id: profile.id,
    name: profile.name,
    upgradeAllowed: profile.upgradeAllowed === true,
    cutoff,
    qualities,
    minFormatScore: finiteOrNull(profile.minFormatScore),
    cutoffFormatScore: finiteOrNull(profile.cutoffFormatScore),
    minUpgradeFormatScore: finiteOrNull(profile.minUpgradeFormatScore),
    language: profile.language?.name ?? null,
    formats,
  };
}

function clientFor(type: ArrServiceType, connection: Awaited<ReturnType<typeof resolveConnection>>) {
  const headers = getConnectionHeaders(connection);
  if (type === 'SONARR') return new SonarrClient(connection.url, connection.apiKey, headers);
  if (type === 'RADARR') return new RadarrClient(connection.url, connection.apiKey, headers);
  return new LidarrClient(connection.url, connection.apiKey, headers);
}

/**
 * GET one quality profile of the instance in `instanceId` (validated against
 * `type` by resolveConnection) as a QualityProfileSummary. Callers check the
 * capability first.
 */
export async function qualityProfileResponse(
  type: ArrServiceType,
  instanceId: string | undefined,
  rawId: string,
): Promise<NextResponse> {
  const id = Number(rawId);
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid quality profile id' }, { status: 400 });
  }

  try {
    const connection = await resolveConnection(type, instanceId);
    const scope = `${type.toLowerCase()}-qualityprofile`;
    const keySeed = `${connection.id}:${id}`;
    let summary = await getCachedJson<QualityProfileSummary>(scope, keySeed);
    if (!summary) {
      summary = summarizeQualityProfile(await clientFor(type, connection).getQualityProfile(id));
      await setCachedJson(scope, keySeed, summary, PROFILE_TTL_SECONDS);
    }
    return NextResponse.json(summary, { headers: REFERENCE_CACHE_HEADERS });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch quality profile');
  }
}
