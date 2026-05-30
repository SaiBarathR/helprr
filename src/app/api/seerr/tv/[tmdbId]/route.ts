import { NextRequest, NextResponse } from 'next/server';
import { getSeerrClient } from '@/lib/service-helpers';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';

// Season list (numbers + episode counts + per-season Seerr status) for the
// series request/approve modal's season-selection table.
async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ tmdbId: string }> }
): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  if (!can(auth.user, 'requests.view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { tmdbId: raw } = await params;
  const tmdbId = Number.parseInt(raw, 10);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return NextResponse.json({ error: 'Invalid tmdbId' }, { status: 400 });
  }

  try {
    const client = await getSeerrClient();
    const seasons = await client.getTvSeasons(tmdbId);
    return NextResponse.json({ seasons });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load seasons';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/seerr/tv/[tmdbId]');
