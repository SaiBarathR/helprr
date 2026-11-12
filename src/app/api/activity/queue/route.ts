import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { readJsonBody } from '@/lib/bulk-editor';
import { recordOperationAudit } from '@/lib/file-audit';
import { asJsonObject, resolveActivityArrTarget } from '@/lib/activity-arr-target';
import { bumpQueueCacheVersion, fetchAllQueueRecords, getQueueCached, getQueueNeedingImportCached } from '@/lib/activity-queue';
import { parsePageParams } from '@/lib/pagination';
import { resolveConnection } from '@/lib/arr-instances';
import {
  filterQueueItemsForMedia,
  type MediaQueueSource,
} from '@/lib/media-download-progress';

// no-cache (not max-age): a browser HTTP cache can't be busted by the queue
// version bump on removal, so it would serve a pre-delete body to the reconcile
// refetch and flash removed rows back. The server-side Redis window
// (QUEUE_CACHE_TTL_SECONDS in lib/activity-queue.ts) still collapses poll bursts.
const QUEUE_CACHE_HEADERS = {
  'Cache-Control': 'private, no-cache',
  // Partition the private cache by session cookie so a capability-gated response can't be
  // replayed from the browser cache to a different (or logged-out) user within the TTL.
  'Vary': 'Cookie',
} as const;

// Queue loading + caching + in-flight dedupe live in lib/activity-queue.ts,
// shared with the polling service's cache warmer. The capability gate still
// runs per request before the cache is read.

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('activity.view');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    // The Needs import tab: downloads waiting on a manual import, from the whole queue.
    if (searchParams.get('view') === 'needs-import') {
      return NextResponse.json(await getQueueNeedingImportCached(), { headers: QUEUE_CACHE_HEADERS });
    }
    const { page, pageSize } = parsePageParams(searchParams, { defaultSize: 50, maxSize: 200 });

    const sourceValue = searchParams.get('source');
    const mediaIdValue = searchParams.get('mediaId');
    const instanceId = searchParams.get('instanceId') || undefined;
    const hasMediaFilter = sourceValue !== null || mediaIdValue !== null || instanceId !== undefined;

    if (hasMediaFilter) {
      const source = sourceValue === 'sonarr' || sourceValue === 'radarr'
        ? sourceValue as MediaQueueSource
        : null;
      const mediaId = mediaIdValue && /^\d+$/.test(mediaIdValue) ? Number(mediaIdValue) : NaN;
      if (!source || !Number.isSafeInteger(mediaId) || mediaId <= 0) {
        return NextResponse.json({ error: 'source and a positive mediaId are required' }, { status: 400 });
      }

      let resolvedInstanceId: string;
      try {
        const connection = await resolveConnection(source === 'sonarr' ? 'SONARR' : 'RADARR', instanceId);
        resolvedInstanceId = connection.id;
      } catch {
        return NextResponse.json({ error: 'Invalid or unavailable media instance' }, { status: 400 });
      }

      const result = await getQueueCached(1, 200);
      const records = filterQueueItemsForMedia(result.records, source, mediaId, resolvedInstanceId);
      return NextResponse.json(
        { records, totalRecords: records.length },
        { headers: QUEUE_CACHE_HEADERS },
      );
    }

    const result = await getQueueCached(page, pageSize);
    return NextResponse.json(result, { headers: QUEUE_CACHE_HEADERS });
  } catch (error) {
    console.error('Failed to fetch queue:', error);
    return NextResponse.json(
      { error: 'Failed to fetch queue' },
      { status: 500 }
    );
  }
}

// A selection can hold every loaded queue record; also bounds a hostile body.
const QUEUE_BULK_MAX_IDS = 1000;
const QUEUE_REMOVE_OPTIONS = ['removeFromClient', 'blocklist', 'skipRedownload', 'changeCategory'] as const;

// A hung instance already cost the removal's own timeout; the re-read adds at most this.
const REMOVAL_REREAD_TIMEOUT_MS = 10_000;

// Which of the requested ids the instance's queue no longer lists, read right after
// the removal: removedIds also holds ids that were already gone before it. Null when
// the queue could not be read in full in time.
async function readRemovalOutcome(
  client: Parameters<typeof fetchAllQueueRecords>[0],
  ids: number[],
): Promise<{ removedIds: number[]; remainingIds: number[] } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const queue = await Promise.race([
      fetchAllQueueRecords(client, true),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Queue re-read timed out')), REMOVAL_REREAD_TIMEOUT_MS);
      }),
    ]);
    if (queue.records.length < queue.totalRecords) return null;
    const listed = new Set(queue.records.map((record) => record.id));
    return {
      removedIds: ids.filter((id) => !listed.has(id)),
      remainingIds: ids.filter((id) => listed.has(id)),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── DELETE /api/activity/queue ──────────────────────────────────────────────
// Body: { source, instanceId, ids, removeFromClient?, blocklist?, skipRedownload?,
// changeCategory? }. Removes several of one instance's queue items with the single
// Remove dialog's options. Audited as one REMOVE_QUEUE row per request, with the ids
// a re-read of the queue still lists (remainingIds) and no longer lists (removedIds,
// which includes ids already gone before the call), or outcome 'partial-unknown'
// when that re-read fails.
async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

  try {
    const body = asJsonObject(await readJsonBody(request));
    if (!body) return NextResponse.json({ error: 'Expected a JSON object' }, { status: 400 });
    const { ids } = body;
    if (
      !Array.isArray(ids)
      || ids.length === 0
      || ids.length > QUEUE_BULK_MAX_IDS
      || !ids.every((id) => Number.isSafeInteger(id) && id >= 0 && id <= 2_147_483_647)
    ) {
      return NextResponse.json(
        { error: `ids must be an array of 1 to ${QUEUE_BULK_MAX_IDS} queue item ids` },
        { status: 400 },
      );
    }
    if (QUEUE_REMOVE_OPTIONS.some((key) => body[key] !== undefined && typeof body[key] !== 'boolean')) {
      return NextResponse.json({ error: 'Removal options must be booleans' }, { status: 400 });
    }
    const options = {
      removeFromClient: body.removeFromClient === true,
      blocklist: body.blocklist === true,
      skipRedownload: body.skipRedownload === true,
      changeCategory: body.changeCategory === true,
    };
    const uniqueIds = [...new Set(ids as number[])];

    const resolved = await resolveActivityArrTarget(body.source, body.instanceId);
    if (!resolved.ok) return resolved.response;
    const { source, service, appName, instanceId, client } = resolved.target;

    const single = uniqueIds.length === 1;
    const startedAt = new Date();
    let failure: unknown = null;
    try {
      await client.deleteQueueBulk(uniqueIds, options);
    } catch (error) {
      failure = error;
    }
    // Upstream removes item by item and skips ids it no longer has, so neither a
    // success nor a failure says what was removed: ask the queue again.
    const outcome = await readRemovalOutcome(client, uniqueIds);
    await recordOperationAudit({
      user: auth.user,
      service,
      instanceId,
      operation: 'REMOVE_QUEUE',
      targetType: 'queue',
      targetId: single ? uniqueIds[0] : null,
      targetTitle: single
        ? `${appName} queue item #${uniqueIds[0]}`
        : `${uniqueIds.length} ${appName} queue items`,
      itemCount: outcome ? outcome.removedIds.length : uniqueIds.length,
      filesDeleted: options.removeFromClient,
      details: { source, queueIds: uniqueIds, ...options, ...(outcome ?? { outcome: 'partial-unknown' }) },
      startedAt,
      success: failure === null,
      errorMessage: failure === null
        ? null
        : failure instanceof Error ? failure.message : 'Upstream operation failed',
    });
    // As for a single removal: no cached page may resurrect a removed row. Also on
    // failure, since some items may already be gone.
    await bumpQueueCacheVersion();
    if (failure !== null) throw failure;
    return NextResponse.json({ success: true, requested: uniqueIds.length });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to remove queue items');
  }
}

export const GET = withApiLogging(getHandler, 'api/activity/queue');
export const DELETE = withApiLogging(deleteHandler, 'api/activity/queue');
