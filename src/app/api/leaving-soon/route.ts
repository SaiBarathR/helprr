import { NextRequest, NextResponse } from 'next/server';
import { requireUserAnyCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { can } from '@/lib/permissions';
import { isLibraryMediaType, type LibraryMediaType } from '@/lib/library-cleanup/config';
import { listLeavingSoon } from '@/lib/library-cleanup/service';

// The Leaving soon shelf: only the library types the caller may view. Admins
// also get why each title qualified and who requested it.
async function getHandler(req: NextRequest) {
  const auth = await requireUserAnyCapability(['movies.view', 'series.view']);
  if (!auth.ok) return auth.response;
  const requested = req.nextUrl.searchParams.get('type');
  if (requested !== null && !isLibraryMediaType(requested)) {
    return NextResponse.json({ error: 'type must be "movie" or "series"' }, { status: 400 });
  }
  const allowed: LibraryMediaType[] = [];
  if (can(auth.user, 'movies.view')) allowed.push('movie');
  if (can(auth.user, 'series.view')) allowed.push('series');
  const types = requested ? allowed.filter((type) => type === requested) : allowed;
  const items = await listLeavingSoon(types, auth.user.role === 'admin');
  return NextResponse.json({ items });
}

export const GET = withApiLogging(getHandler, 'api/leaving-soon');
