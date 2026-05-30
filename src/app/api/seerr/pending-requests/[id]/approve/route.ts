import { NextRequest, NextResponse } from 'next/server';
import { isAxiosError } from 'axios';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { getSeerrClient } from '@/lib/service-helpers';
import { notifyEvent } from '@/lib/notification-service';
import { withApiLogging } from '@/lib/api-logger';
import { logger } from '@/lib/logger';

function parseTags(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((t): t is number => Number.isInteger(t) && (t as number) >= 0);
}

function parseSeasons(value: unknown): number[] | 'all' | undefined {
  if (value === undefined) return undefined;
  if (value === 'all') return 'all';
  if (!Array.isArray(value)) return undefined;
  const out: number[] = [];
  for (const e of value) {
    if (!Number.isInteger(e) || (e as number) < 0) return undefined;
    out.push(e as number);
  }
  return out;
}

// Approve a Helprr-pending request: create it in Seerr (with optional admin
// override edits) attributed to the original member, then drop the local row.
async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('requests.approve');
  if (capError) return capError;

  const { id } = await params;
  const pending = await prisma.pendingRequest.findUnique({ where: { id } });
  if (!pending) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // Body overrides win over the member's stored choices; fall back to stored.
  const storedSeasons = Array.isArray(pending.seasons) ? (pending.seasons as number[]) : undefined;
  const seasons = parseSeasons(body.seasons) ?? storedSeasons;
  const storedTags = Array.isArray(pending.tags) ? (pending.tags as number[]) : undefined;
  const tags = parseTags(body.tags) ?? storedTags;

  // Attribution: admin "Request As" override, else the member's snapshot id.
  const attributeUserId =
    typeof body.requestAs === 'number' && body.requestAs > 0
      ? body.requestAs
      : pending.seerrUserId
        ? Number.parseInt(pending.seerrUserId, 10)
        : undefined;

  const mediaType = pending.mediaType as 'movie' | 'tv';

  try {
    const client = await getSeerrClient();
    const created = await client.createRequest({
      mediaType,
      mediaId: pending.tmdbId,
      is4k: pending.is4k,
      seasons,
      userId: Number.isInteger(attributeUserId) ? attributeUserId : undefined,
      serverId: typeof body.serverId === 'number' ? body.serverId : pending.serverId ?? undefined,
      profileId: typeof body.profileId === 'number' ? body.profileId : pending.profileId ?? undefined,
      rootFolder:
        typeof body.rootFolder === 'string' && body.rootFolder
          ? body.rootFolder
          : pending.rootFolder ?? undefined,
      languageProfileId:
        typeof body.languageProfileId === 'number'
          ? body.languageProfileId
          : pending.languageProfileId ?? undefined,
      tags,
    });

    await prisma.pendingRequest.delete({ where: { id } }).catch(() => {});

    if (pending.userId) {
      await notifyEvent({
        eventType: 'requestApproved',
        title: 'Request approved',
        body: `Your request for ${pending.title ?? (mediaType === 'tv' ? 'a series' : 'a movie')} was approved`,
        url: '/requests',
        userIds: [pending.userId],
        ownerUserId: pending.userId,
      }).catch(() => {});
    }

    return NextResponse.json({ request: created });
  } catch (error) {
    logger.error(
      'Pending-request approval failed',
      error instanceof Error ? { message: error.message } : { error },
      { scope: 'api/seerr/pending-requests/[id]/approve' }
    );
    if (isAxiosError(error) && error.response && error.response.status < 500) {
      const data = error.response.data as { message?: unknown } | undefined;
      const message = typeof data?.message === 'string' ? data.message : 'Seerr rejected the request';
      return NextResponse.json({ error: message }, { status: error.response.status });
    }
    return NextResponse.json({ error: 'Failed to approve request' }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/seerr/pending-requests/[id]/approve');
