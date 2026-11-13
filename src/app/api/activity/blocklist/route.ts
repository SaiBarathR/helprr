import { NextRequest, NextResponse } from 'next/server';
import {
  getSonarrClient,
  getRadarrClient,
  getLidarrClient,
  getSonarrClients,
  getRadarrClients,
  getLidarrClients,
} from '@/lib/service-helpers';
import { listConnections } from '@/lib/arr-instances';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { activitySourceForbidden } from '@/lib/activity-arr-target';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { readJsonBody } from '@/lib/bulk-editor';
import { parsePageParams } from '@/lib/pagination';
import { runWithOperationAudit } from '@/lib/file-audit';
import {
  ACTIVITY_HISTORY_SOURCE_CONCURRENCY,
  mapSettledWithLimit,
  type ActivityHistorySource,
} from '@/lib/activity-history';
import type { BlocklistItem, BlocklistResponse } from '@/types';

// Each instance is asked for its newest `page * pageSize` entries and the lists
// are merged by date, as Activity History does; the window bounds that fan-out.
const BLOCKLIST_MAX_WINDOW = 1000;
const BLOCKLIST_MAX_PAGE_SIZE = 100;
// A selection can hold every entry the list can show; also bounds a hostile body.
const BLOCKLIST_MAX_IDS = BLOCKLIST_MAX_WINDOW;

const SERVICE = { sonarr: 'SONARR', radarr: 'RADARR', lidarr: 'LIDARR' } as const;
const APP_NAME = { sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr' } as const;

// A removal must show on the next load, so the list is never cached.
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

type BlocklistRecord = BlocklistItem & {
  source: ActivityHistorySource;
  instanceId: string;
  instanceLabel: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSource(value: unknown): value is ActivityHistorySource {
  return value === 'sonarr' || value === 'radarr' || value === 'lidarr';
}

// ── GET /api/activity/blocklist ─────────────────────────────────────────────
// Every Sonarr/Radarr/Lidarr instance's blocklist (or one instance's), newest first.
async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('activity.view');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const { page, pageSize } = parsePageParams(searchParams, {
      defaultSize: 20,
      maxSize: BLOCKLIST_MAX_PAGE_SIZE,
    });
    const endIndex = page * pageSize;
    if (endIndex > BLOCKLIST_MAX_WINDOW) {
      return NextResponse.json(
        { error: `requested blocklist window exceeds ${BLOCKLIST_MAX_WINDOW} entries` },
        { status: 400 },
      );
    }
    const instanceId = searchParams.get('instanceId')?.trim() || undefined;
    if (instanceId && instanceId.length > 128) {
      return NextResponse.json({ error: 'instanceId is too long' }, { status: 400 });
    }

    const [sonarr, radarr, lidarr] = await Promise.allSettled([
      getSonarrClients(),
      getRadarrClients(),
      // Lidarr's entries only for viewers who may see the music library.
      can(auth.user, 'music.view') ? getLidarrClients() : Promise.resolve([]),
    ]);
    const failedSources = new Set<ActivityHistorySource>();
    const descriptors: Array<{
      source: ActivityHistorySource;
      instanceId: string;
      instanceLabel: string;
      fetch: () => Promise<BlocklistResponse>;
    }> = [];
    for (const [source, load] of [['sonarr', sonarr], ['radarr', radarr], ['lidarr', lidarr]] as const) {
      if (load.status === 'rejected') {
        failedSources.add(source);
        continue;
      }
      // An instanceId belongs to exactly one type, so the other lists filter to empty.
      for (const { connection, client } of load.value) {
        if (instanceId && connection.id !== instanceId) continue;
        descriptors.push({
          source,
          instanceId: connection.id,
          instanceLabel: connection.label,
          fetch: () => client.getBlocklist(1, endIndex),
        });
      }
    }

    const results = await mapSettledWithLimit(
      descriptors,
      ACTIVITY_HISTORY_SOURCE_CONCURRENCY,
      (descriptor) => descriptor.fetch(),
    );
    const records: BlocklistRecord[] = [];
    let totalRecords = 0;
    let succeeded = 0;
    results.forEach((result, index) => {
      const { source, instanceId: id, instanceLabel } = descriptors[index];
      if (result.status === 'rejected') {
        failedSources.add(source);
        return;
      }
      succeeded += 1;
      const rows = Array.isArray(result.value?.records) ? result.value.records : [];
      totalRecords += Math.max(Number(result.value?.totalRecords) || 0, rows.length);
      for (const row of rows.slice(0, endIndex)) {
        records.push({ ...row, source, instanceId: id, instanceLabel });
      }
    });

    if (succeeded === 0 && failedSources.size > 0) {
      return NextResponse.json(
        { error: 'Failed to fetch blocklist', partial: true, failedSources: [...failedSources] },
        { status: 502 },
      );
    }

    records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const moreAvailable = totalRecords > endIndex;
    return NextResponse.json({
      page,
      pageSize,
      totalRecords,
      hasMore: moreAvailable && endIndex < BLOCKLIST_MAX_WINDOW,
      truncated: moreAvailable && endIndex >= BLOCKLIST_MAX_WINDOW,
      partial: failedSources.size > 0,
      failedSources: [...failedSources],
      records: records.slice((page - 1) * pageSize, endIndex),
    }, { headers: NO_STORE });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch blocklist');
  }
}

/**
 * The release titles of the entries about to be removed, read from the *arr
 * itself (never from the request), for the audit row. One read of the newest
 * entries the list can show; an entry outside it, or a failed read, has no
 * title and the row falls back to its id.
 */
async function releaseTitles(
  client: { getBlocklist: (page: number, pageSize: number) => Promise<BlocklistResponse> },
  ids: number[],
): Promise<Map<number, string>> {
  const wanted = new Set(ids);
  const titles = new Map<number, string>();
  try {
    const { records } = await client.getBlocklist(1, BLOCKLIST_MAX_WINDOW);
    for (const row of Array.isArray(records) ? records : []) {
      if (wanted.has(row.id) && typeof row.sourceTitle === 'string' && row.sourceTitle) {
        titles.set(row.id, row.sourceTitle);
      }
    }
  } catch {
    // Audit detail only: the removal goes ahead and the row keeps the ids.
  }
  return titles;
}

// ── DELETE /api/activity/blocklist ──────────────────────────────────────────
// Body: { source, instanceId, ids }. Removes (unblocks) entries of one instance's
// blocklist, so the *arr may grab those releases again. Audited as one row.
async function deleteHandler(request: NextRequest) {
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

  try {
    const json = await readJsonBody(request);
    if (!json.ok || !isRecord(json.body)) {
      return NextResponse.json({ error: 'Expected a JSON object' }, { status: 400 });
    }
    const { source, instanceId, ids } = json.body;
    if (!isSource(source)) {
      return NextResponse.json({ error: 'source must be "sonarr", "radarr" or "lidarr"' }, { status: 400 });
    }
    const forbidden = activitySourceForbidden(auth.user, source);
    if (forbidden) return forbidden;
    if (typeof instanceId !== 'string' || !instanceId || instanceId.length > 128) {
      return NextResponse.json({ error: 'instanceId is required' }, { status: 400 });
    }
    if (
      !Array.isArray(ids)
      || ids.length === 0
      || ids.length > BLOCKLIST_MAX_IDS
      || !ids.every((id) => Number.isSafeInteger(id) && id > 0)
    ) {
      return NextResponse.json(
        { error: `ids must be an array of 1 to ${BLOCKLIST_MAX_IDS} positive integers` },
        { status: 400 },
      );
    }
    const uniqueIds = [...new Set(ids as number[])];

    // Entry ids are per instance: the request must name one of this type's instances,
    // never fall back to the default one.
    const service = SERVICE[source];
    const connections = await listConnections(service);
    if (!connections.some((connection) => connection.id === instanceId)) {
      return NextResponse.json({ error: `Unknown ${APP_NAME[source]} instance` }, { status: 400 });
    }

    const client = source === 'sonarr'
      ? await getSonarrClient(instanceId)
      : source === 'radarr'
        ? await getRadarrClient(instanceId)
        : await getLidarrClient(instanceId);
    const single = uniqueIds.length === 1;
    const titles = await releaseTitles(client, uniqueIds);
    await runWithOperationAudit({
      user: auth.user,
      service,
      instanceId,
      operation: 'REMOVE_BLOCKLIST',
      targetType: 'blocklist',
      targetId: single ? uniqueIds[0] : null,
      targetTitle: single
        ? titles.get(uniqueIds[0]) ?? `${APP_NAME[source]} blocklist entry #${uniqueIds[0]}`
        : `${uniqueIds.length} ${APP_NAME[source]} blocklist entries`,
      itemCount: uniqueIds.length,
      // Each entry's release title from the *arr, or its id alone when the lookup missed it.
      details: { source, ids: uniqueIds, titles: uniqueIds.map((id) => titles.get(id) ?? `#${id}`) },
    }, () => (single ? client.deleteBlocklistItem(uniqueIds[0]) : client.deleteBlocklistBulk(uniqueIds)));

    return NextResponse.json({ success: true, removed: uniqueIds.length });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to remove blocklist entries');
  }
}

export const GET = withApiLogging(getHandler, 'api/activity/blocklist');
export const DELETE = withApiLogging(deleteHandler, 'api/activity/blocklist');
