import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { AniListReauthRequiredError, loadAniListConnection } from '@/lib/anilist-oauth';
import {
  deleteMediaListEntry,
  fetchUserMediaListEntry,
  saveMediaListEntry,
  type AniListMediaListStatus,
  type SaveMediaListEntryInput,
} from '@/lib/anilist-mutations';

const VALID_STATUSES: AniListMediaListStatus[] = [
  'CURRENT',
  'PLANNING',
  'COMPLETED',
  'DROPPED',
  'PAUSED',
  'REPEATING',
];

function reauthResponse(): NextResponse {
  return NextResponse.json(
    { error: 'AniList re-authentication required', requiresReauth: true },
    { status: 401 }
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseFuzzyDate(value: unknown): { year?: number; month?: number; day?: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const result: { year?: number; month?: number; day?: number } = {};
  if (isFiniteNumber(v.year)) result.year = v.year;
  if (isFiniteNumber(v.month)) result.month = v.month;
  if (isFiniteNumber(v.day)) result.day = v.day;
  return Object.keys(result).length > 0 ? result : undefined;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const mediaId = Number(request.nextUrl.searchParams.get('mediaId'));
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return NextResponse.json({ error: 'mediaId is required' }, { status: 400 });
  }

  const conn = await loadAniListConnection();
  if (!conn?.accessToken || !conn.anilistUserId) {
    return NextResponse.json(
      { error: 'AniList not connected', requiresReauth: !!conn },
      { status: 400 }
    );
  }

  try {
    const entry = await fetchUserMediaListEntry({ userId: conn.anilistUserId, mediaId });
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof AniListReauthRequiredError) return reauthResponse();
    console.error('AniList fetch list entry failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch entry' },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const mediaId = Number(b.mediaId);
  if (!Number.isFinite(mediaId) || mediaId <= 0) {
    return NextResponse.json({ error: 'mediaId is required' }, { status: 400 });
  }

  const input: SaveMediaListEntryInput = { mediaId };

  if (typeof b.status === 'string' && (VALID_STATUSES as string[]).includes(b.status)) {
    input.status = b.status as AniListMediaListStatus;
  }
  if (isFiniteNumber(b.score)) input.score = b.score;
  if (isFiniteNumber(b.progress)) input.progress = b.progress;
  if (isFiniteNumber(b.progressVolumes)) input.progressVolumes = b.progressVolumes;
  if (isFiniteNumber(b.repeat)) input.repeat = b.repeat;
  if (typeof b.notes === 'string') input.notes = b.notes;

  const startedAt = parseFuzzyDate(b.startedAt);
  if (startedAt) input.startedAt = startedAt;
  const completedAt = parseFuzzyDate(b.completedAt);
  if (completedAt) input.completedAt = completedAt;

  try {
    const entry = await saveMediaListEntry(input);
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof AniListReauthRequiredError) return reauthResponse();
    console.error('AniList saveMediaListEntry failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save entry' },
      { status: 502 }
    );
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const idParam = request.nextUrl.searchParams.get('id');
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  try {
    const result = await deleteMediaListEntry(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AniListReauthRequiredError) return reauthResponse();
    console.error('AniList deleteMediaListEntry failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete entry' },
      { status: 502 }
    );
  }
}
