import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

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

async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('requests.approve');
  if (capError) return capError;

  try {
    const { id: raw } = await params;
    if (!/^\d+$/.test(raw)) {
      return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
    }
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
    }

    // Optional approve-with-overrides: the modal sends the chosen profile/folder/
    // tags/seasons/Request-As. Seerr has no override on /approve, so we PUT the
    // request first (when overrides are present), then approve.
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const mediaType = body.mediaType;
    const hasOverrides =
      body.profileId !== undefined ||
      body.rootFolder !== undefined ||
      body.serverId !== undefined ||
      body.languageProfileId !== undefined ||
      body.tags !== undefined ||
      body.seasons !== undefined ||
      body.requestAs !== undefined;

    const client = await getSeerrClient();

    if (hasOverrides && (mediaType === 'movie' || mediaType === 'tv')) {
      await client.updateRequest(id, {
        mediaType,
        seasons: parseSeasons(body.seasons),
        serverId: typeof body.serverId === 'number' ? body.serverId : undefined,
        profileId: typeof body.profileId === 'number' ? body.profileId : undefined,
        rootFolder: typeof body.rootFolder === 'string' && body.rootFolder ? body.rootFolder : undefined,
        languageProfileId: typeof body.languageProfileId === 'number' ? body.languageProfileId : undefined,
        tags: parseTags(body.tags),
        userId: typeof body.requestAs === 'number' && body.requestAs > 0 ? body.requestAs : undefined,
      });
    }

    const data = await client.approveRequest(id);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to approve request';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/seerr/requests/[id]/approve');
