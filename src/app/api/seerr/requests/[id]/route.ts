import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability, requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

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

async function getHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUserCapability('requests.view');
  if (!auth.ok) return auth.response;

  try {
    const { id: raw } = await params;
    const id = parseId(raw);
    if (id === null) return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
    const client = await getSeerrClient();
    const data = await client.getRequest(id);
    // A non-admin may only read their own request; report others as 404.
    if (auth.user.role !== 'admin') {
      const ownerId = (data as { requestedBy?: { id?: number } })?.requestedBy?.id;
      const own = auth.user.seerrUserId ? Number.parseInt(auth.user.seerrUserId, 10) : NaN;
      if (!Number.isInteger(own) || ownerId !== own) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
    }
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch request';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function deleteHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('requests.approve');
  if (capError) return capError;

  try {
    const { id: raw } = await params;
    const id = parseId(raw);
    if (id === null) return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });
    const client = await getSeerrClient();
    await client.deleteRequest(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete request';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Edit a (pending) request — quality profile, root folder, tags, seasons, and
// "Request As". Admin-only (request management).
async function putHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('requests.approve');
  if (capError) return capError;

  try {
    const { id: raw } = await params;
    const id = parseId(raw);
    if (id === null) return NextResponse.json({ error: 'Invalid request id' }, { status: 400 });

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const mediaType = body.mediaType;
    if (mediaType !== 'movie' && mediaType !== 'tv') {
      return NextResponse.json({ error: "mediaType must be 'movie' or 'tv'" }, { status: 400 });
    }

    const client = await getSeerrClient();
    const updated = await client.updateRequest(id, {
      mediaType,
      seasons: parseSeasons(body.seasons),
      serverId: typeof body.serverId === 'number' ? body.serverId : undefined,
      profileId: typeof body.profileId === 'number' ? body.profileId : undefined,
      rootFolder: typeof body.rootFolder === 'string' && body.rootFolder ? body.rootFolder : undefined,
      languageProfileId: typeof body.languageProfileId === 'number' ? body.languageProfileId : undefined,
      tags: parseTags(body.tags),
      userId: typeof body.requestAs === 'number' && body.requestAs > 0 ? body.requestAs : undefined,
    });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update request';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/seerr/requests/[id]');
export const PUT = withApiLogging(putHandler, 'api/seerr/requests/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/seerr/requests/[id]');
