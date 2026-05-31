import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { AniListReauthRequiredError, loadAniListConnection } from '@/lib/anilist-oauth';
import { withApiLogging } from '@/lib/api-logger';
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
  if (isFiniteNumber(v.year)) result.year = Math.trunc(v.year);
  if (isFiniteNumber(v.month)) result.month = Math.trunc(v.month);
  if (isFiniteNumber(v.day)) result.day = Math.trunc(v.day);
  return Object.keys(result).length > 0 ? result : undefined;
}

function isValidFuzzyDate(value: { year?: number; month?: number; day?: number }): boolean {
  if (value.year !== undefined && (value.year < 1 || value.year > 9999)) return false;
  if (value.month !== undefined && (value.month < 1 || value.month > 12)) return false;
  if (value.day !== undefined) {
    if (value.day < 1) return false;
    const daysInMonth = value.year && value.month
      ? new Date(value.year, value.month, 0).getDate()
      : 31;
    if (value.day > daysInMonth) return false;
  }
  return true;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  // Shared operator account — reading the entry status is admin-only (see postHandler).
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

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

async function postHandler(request: NextRequest): Promise<NextResponse> {
  // The AniList connection is a single shared operator account (one OAuth token),
  // so mutating the list is admin-only — a member must not alter the operator's list.
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

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

  if (hasOwn(b, 'status')) {
    if (typeof b.status !== 'string' || !(VALID_STATUSES as string[]).includes(b.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    input.status = b.status as AniListMediaListStatus;
  }
  if (hasOwn(b, 'score')) {
    if (!isFiniteNumber(b.score) || b.score < 0 || b.score > 100) {
      return NextResponse.json({ error: 'Invalid score' }, { status: 400 });
    }
    input.score = b.score;
  }
  if (hasOwn(b, 'progress')) {
    if (!isFiniteNumber(b.progress) || b.progress < 0) {
      return NextResponse.json({ error: 'Invalid progress' }, { status: 400 });
    }
    input.progress = Math.trunc(b.progress);
  }
  if (hasOwn(b, 'progressVolumes')) {
    if (!isFiniteNumber(b.progressVolumes) || b.progressVolumes < 0) {
      return NextResponse.json({ error: 'Invalid progressVolumes' }, { status: 400 });
    }
    input.progressVolumes = Math.trunc(b.progressVolumes);
  }
  if (hasOwn(b, 'repeat')) {
    if (!isFiniteNumber(b.repeat) || b.repeat < 0) {
      return NextResponse.json({ error: 'Invalid repeat' }, { status: 400 });
    }
    input.repeat = Math.trunc(b.repeat);
  }
  if (typeof b.notes === 'string') input.notes = b.notes;

  const startedAt = parseFuzzyDate(b.startedAt);
  if (hasOwn(b, 'startedAt') && (!startedAt || !isValidFuzzyDate(startedAt))) {
    return NextResponse.json({ error: 'Invalid startedAt' }, { status: 400 });
  }
  if (startedAt) input.startedAt = startedAt;
  const completedAt = parseFuzzyDate(b.completedAt);
  if (hasOwn(b, 'completedAt') && (!completedAt || !isValidFuzzyDate(completedAt))) {
    return NextResponse.json({ error: 'Invalid completedAt' }, { status: 400 });
  }
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

async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  // Shared operator account — deletion is admin-only (see postHandler).
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

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

export const GET = withApiLogging(getHandler, 'api/anilist/list-entry');
export const POST = withApiLogging(postHandler, 'api/anilist/list-entry');
export const DELETE = withApiLogging(deleteHandler, 'api/anilist/list-entry');
