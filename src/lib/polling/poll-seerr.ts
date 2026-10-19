// Seerr: new requests and their approval, decline, failure and availability; the requests badge.
import { prisma } from '@/lib/db';
import { getSeerrClient } from '@/lib/service-helpers';
import { ConfigurationError } from '@/lib/config-error';
import { getDefaultConnection } from '@/lib/arr-instances';
import { SEERR_MEDIA_STATUS, SEERR_REQUEST_STATUS } from '@/types/seerr';
import { getCachedSeerrMediaDetail, formatSeerrMediaLabel } from '@/lib/seerr-helpers';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { writeBadgeSlice } from '@/lib/cache/badge-counts';
import { notifyAndLog } from './shared';

export async function pollSeerr() {
  let client;
  try {
    client = await getSeerrClient();
  } catch (error) {
    if (!(error instanceof ConfigurationError)) noteJobFailure(error);
    logger.debug('Skipping Seerr poll because client is unavailable', { error }, { scope: 'polling' });
    return;
  }

  const connection = await getDefaultConnection('SEERR');
  if (!connection) return;

  const state = await prisma.pollingState.upsert({
    where: { serviceConnectionId: connection.id },
    update: {},
    create: { serviceConnectionId: connection.id, lastQueueIds: [] },
  });

  let listing;
  try {
    listing = await client.listRequests({ take: 50, skip: 0, sort: 'added', sortDirection: 'desc' });
  } catch (error) {
    noteJobFailure(error);
    logger.warn('Seerr request poll failed', error, { scope: 'polling' });
    return;
  }

  const requests = listing.results;

  type Snapshot = { id: number; reqStatus: number; mediaStatus: number };
  const prevSnapshots: Snapshot[] = Array.isArray(state.lastQueueIds)
    ? (state.lastQueueIds as unknown as Snapshot[]).filter(
        (s) =>
          s &&
          typeof s === 'object' &&
          typeof (s as Snapshot).id === 'number' &&
          typeof (s as Snapshot).reqStatus === 'number' &&
          typeof (s as Snapshot).mediaStatus === 'number'
      )
    : [];
  const prevMap = new Map(prevSnapshots.map((s) => [s.id, s]));
  const firstRun = prevSnapshots.length === 0;
  // High-water mark: Seerr request IDs are auto-increment, so anything not
  // in prevMap whose id is <= lastMaxId is an old request that slid into our
  // top-50 window because a newer one was deleted — not a creation.
  const lastMaxId = prevSnapshots.reduce((m, s) => (s.id > m ? s.id : m), 0);

  logger.debug('Seerr requests polled', {
    requestCount: requests.length,
    previousCount: prevSnapshots.length,
    firstRun,
  }, { scope: 'polling' });

  // Request-status notifications go to the requesting member plus every admin
  // (approvers stay in the loop). Resolve the admin list once per cycle.
  const adminIds = (
    await prisma.user.findMany({
      where: { role: 'admin', status: 'active' },
      select: { id: true },
    })
  ).map((u) => u.id);

  // Resolve the Helprr owner for every requester in this window in a single
  // query (batched instead of one findFirst per notifying request), keyed by
  // the Seerr user id so the loop is a Map lookup.
  const seerrIds = Array.from(
    new Set(
      requests
        .map((req) => req.requestedBy?.id)
        .filter((id): id is number => id != null)
        .map((id) => String(id))
    )
  );
  const ownerBySeerrId = new Map(
    seerrIds.length
      ? (
          await prisma.user.findMany({
            where: { seerrUserId: { in: seerrIds } },
            select: { id: true, seerrUserId: true },
          })
        ).map((u) => [u.seerrUserId as string, u.id])
      : []
  );

  for (const req of requests) {
    const reqStatus = Number(req.status);
    const mediaStatus = Number(req.media?.status ?? 0);
    const prev = prevMap.get(req.id);
    const requesterLabel =
      req.requestedBy?.displayName ??
      req.requestedBy?.username ??
      req.requestedBy?.plexUsername ??
      req.requestedBy?.jellyfinUsername ??
      `User ${req.requestedBy?.id ?? '?'}`;
    const tmdbId = req.media?.tmdbId;

    // Decide whether this iteration will actually emit a notification before
    // we spend a TMDB lookup — skipping the fetch for the no-op case on the
    // first run keeps poll cycles cheap.
    const willCreate = !prev && !firstRun && req.id > lastMaxId;
    const willStatusChange =
      !!prev &&
      prev.reqStatus !== reqStatus &&
      (reqStatus === SEERR_REQUEST_STATUS.APPROVED ||
        reqStatus === SEERR_REQUEST_STATUS.DECLINED ||
        reqStatus === SEERR_REQUEST_STATUS.FAILED);
    const willBecomeAvailable =
      !!prev &&
      prev.mediaStatus !== mediaStatus &&
      mediaStatus === SEERR_MEDIA_STATUS.AVAILABLE &&
      prev.mediaStatus < SEERR_MEDIA_STATUS.AVAILABLE;

    let detail = null;
    if ((willCreate || willStatusChange || willBecomeAvailable) && tmdbId) {
      try {
        detail = await getCachedSeerrMediaDetail(client, req.type, tmdbId);
      } catch (error) {
        logger.debug('Seerr media detail lookup failed', { error, requestId: req.id }, { scope: 'polling' });
      }
    }
    const mediaLabel = formatSeerrMediaLabel(req, detail);
    const title = detail?.title ?? detail?.name ?? null;
    const metadataBase = {
      source: 'seerr' as const,
      id: req.id,
      tmdbId,
      mediaType: req.type,
      title,
      redirect: '/requests',
    };

    // The Helprr user behind this Seerr request (if linked); status updates are
    // owned by them, with admins copied in.
    const seerrId = req.requestedBy?.id;
    const ownerId = seerrId != null ? ownerBySeerrId.get(String(seerrId)) ?? null : null;
    const ownerAndAdmins = Array.from(new Set([...(ownerId ? [ownerId] : []), ...adminIds]));

    if (!prev) {
      if (firstRun || req.id <= lastMaxId) continue;
      // A brand-new request notifies approvers (admins), not the requester.
      await notifyAndLog({
        eventType: 'requestCreated',
        title: 'New Request',
        body: `${requesterLabel} requested ${mediaLabel}`,
        metadata: metadataBase,
        url: '/requests',
        userIds: adminIds.length ? adminIds : undefined,
      }, { service: 'seerr', reason: 'request-created', requestId: req.id });
      continue;
    }

    if (prev.reqStatus !== reqStatus) {
      if (reqStatus === SEERR_REQUEST_STATUS.APPROVED) {
        await notifyAndLog({
          eventType: 'requestApproved',
          title: 'Request Approved',
          body: `${requesterLabel}'s request for ${mediaLabel} was approved`,
          metadata: metadataBase,
          url: '/requests',
          userIds: ownerAndAdmins.length ? ownerAndAdmins : undefined,
          ownerUserId: ownerId,
        }, { service: 'seerr', reason: 'request-approved', requestId: req.id });
      } else if (reqStatus === SEERR_REQUEST_STATUS.DECLINED) {
        await notifyAndLog({
          eventType: 'requestDeclined',
          title: 'Request Declined',
          body: `${requesterLabel}'s request for ${mediaLabel} was declined`,
          metadata: metadataBase,
          url: '/requests',
          userIds: ownerAndAdmins.length ? ownerAndAdmins : undefined,
          ownerUserId: ownerId,
        }, { service: 'seerr', reason: 'request-declined', requestId: req.id });
      } else if (reqStatus === SEERR_REQUEST_STATUS.FAILED) {
        await notifyAndLog({
          eventType: 'requestFailed',
          title: 'Request Failed',
          body: `${requesterLabel}'s request for ${mediaLabel} failed`,
          metadata: metadataBase,
          url: '/requests',
          userIds: ownerAndAdmins.length ? ownerAndAdmins : undefined,
          ownerUserId: ownerId,
        }, { service: 'seerr', reason: 'request-failed', requestId: req.id });
      }
    }

    if (
      prev.mediaStatus !== mediaStatus &&
      mediaStatus === SEERR_MEDIA_STATUS.AVAILABLE &&
      prev.mediaStatus < SEERR_MEDIA_STATUS.AVAILABLE
    ) {
      await notifyAndLog({
        eventType: 'requestAvailable',
        title: 'Request Available',
        body: `${mediaLabel} is now available (requested by ${requesterLabel})`,
        metadata: metadataBase,
        url: '/requests',
        userIds: ownerAndAdmins.length ? ownerAndAdmins : undefined,
        ownerUserId: ownerId,
      }, { service: 'seerr', reason: 'request-available', requestId: req.id });
    }
  }

  const nextSnapshots: Snapshot[] = requests.map((r) => ({
    id: r.id,
    reqStatus: Number(r.status),
    mediaStatus: Number(r.media?.status ?? 0),
  }));

  await prisma.pollingState.update({
    where: { serviceConnectionId: connection.id },
    data: { lastQueueIds: nextSnapshots as unknown as object },
  });
  logger.debug('Seerr polling state updated', {
    requestCount: nextSnapshots.length,
  }, { scope: 'polling' });

  // Nav badge: pending approvals. The top-50 window above can miss older
  // pending items, so use the dedicated count endpoint for an accurate number.
  try {
    const counts = await client.getRequestCount();
    await writeBadgeSlice('requests', 'seerr', {
      total: counts.pending,
      attention: counts.pending,
    });
  } catch (error) {
    noteJobFailure(error);
    logger.debug('Seerr request-count badge fetch failed', { error }, { scope: 'polling' });
  }
}
