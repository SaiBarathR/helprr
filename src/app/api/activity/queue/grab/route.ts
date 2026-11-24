import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { readJsonBody } from '@/lib/bulk-editor';
import { bumpQueueCacheVersion, fetchAllQueueRecords } from '@/lib/activity-queue';
import { asJsonObject, resolveActivityArrTarget } from '@/lib/activity-arr-target';

// Same bound as the bulk removal: a selection can hold every loaded queue record.
const QUEUE_GRAB_MAX_IDS = 1000;
const QUEUE_READ_TIMEOUT_MS = 10_000;
// Each retry follows a stop that still sent something, so a selection makes
// progress every round; this only bounds a pathological one.
const QUEUE_GRAB_MAX_ROUNDS = 25;

// The ids of the instance's pending (delay-profile, or no download client)
// releases, as its own queue marks them; null when the queue could not be read
// in full in time. Matches isPendingRelease on the Queue tab.
async function readPendingIds(client: Parameters<typeof fetchAllQueueRecords>[0]): Promise<Set<number> | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const queue = await Promise.race([
      fetchAllQueueRecords(client, true),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Queue read timed out')), QUEUE_READ_TIMEOUT_MS);
      }),
    ]);
    if (queue.records.length < queue.totalRecords) return null;
    return new Set(queue.records
      .filter((record) => record.status === 'delay' || record.status === 'downloadClientUnavailable')
      .map((record) => record.id));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── POST /api/activity/queue/grab ───────────────────────────────────────────
// Body: { source, instanceId, ids }. Sends several of one instance's pending
// releases to the download client now, as the single grab does for one.
// The app's bulk grab stops at the first id that is no longer pending, so the
// queue is read first and only the ids still pending are sent (the others come
// back as `skipped`). The batch itself can cause such a stop: a pending season
// pack lists one id per episode, and grabbing the first sends the whole pack and
// drops its other ids. So after a stop the queue is read again: ids gone from
// the pending list were sent (`grabbed`), and the ones still pending are sent
// again while each round sends at least one more. What is still pending after a
// round that sent nothing is `notGrabbed`; when a read fails, the ids not yet
// accounted for come back as `unknown`.
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

  try {
    const body = asJsonObject(await readJsonBody(request));
    if (!body) return NextResponse.json({ error: 'Expected a JSON object' }, { status: 400 });
    const { ids } = body;
    if (
      !Array.isArray(ids)
      || ids.length === 0
      || ids.length > QUEUE_GRAB_MAX_IDS
      || !ids.every((id) => Number.isSafeInteger(id) && id >= 0 && id <= 2_147_483_647)
    ) {
      return NextResponse.json(
        { error: `ids must be an array of 1 to ${QUEUE_GRAB_MAX_IDS} queue item ids` },
        { status: 400 },
      );
    }
    const uniqueIds = [...new Set(ids as number[])];

    const resolved = await resolveActivityArrTarget(auth.user, body.source, body.instanceId);
    if (!resolved.ok) return resolved.response;
    const { client, appName } = resolved.target;

    const pendingBefore = await readPendingIds(client);
    if (!pendingBefore) {
      return NextResponse.json({ error: `Couldn't read the ${appName} queue` }, { status: 502 });
    }
    const pending = uniqueIds.filter((id) => pendingBefore.has(id));
    const skipped = uniqueIds.filter((id) => !pendingBefore.has(id));
    if (pending.length === 0) {
      return NextResponse.json({ grabbed: [], notGrabbed: [], unknown: [], skipped });
    }

    const grabbed: number[] = [];
    let toSend = pending;
    let notGrabbed: number[] = [];
    let unknown: number[] = [];
    let failure: unknown = null;
    for (let round = 0; toSend.length > 0; round++) {
      try {
        await client.grabQueueBulk(toSend);
        grabbed.push(...toSend);
        break;
      } catch (error) {
        failure = error;
      }
      const pendingAfter = await readPendingIds(client);
      if (!pendingAfter) {
        unknown = toSend;
        break;
      }
      const sent = toSend.filter((id) => !pendingAfter.has(id));
      const waiting = toSend.filter((id) => pendingAfter.has(id));
      grabbed.push(...sent);
      if (sent.length === 0 || round + 1 >= QUEUE_GRAB_MAX_ROUNDS) {
        notGrabbed = waiting;
        break;
      }
      toSend = waiting;
    }
    await bumpQueueCacheVersion();
    if (grabbed.length === 0 && unknown.length === 0) throw failure;
    return NextResponse.json({ grabbed, notGrabbed, unknown, skipped });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to grab the releases');
  }
}

export const POST = withApiLogging(postHandler, 'api/activity/queue/grab');
