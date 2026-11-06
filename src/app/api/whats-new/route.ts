import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { APP_VERSION } from '@/lib/app-version';
import { compareVersions, parseSemver } from '@/lib/changelog';
import { getCurrentReleaseNotes, getWhatsNew, markWhatsNewSeen } from '@/lib/whats-new';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

// Release notes since this user's last-seen version (?current=1: the running release's
// notes, for Settings → About). Every signed-in user, each for their own account.
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const notes = request.nextUrl.searchParams.get('current') === '1'
    ? await getCurrentReleaseNotes()
    : await getWhatsNew(auth.user.id);
  return NextResponse.json(notes, { headers: NO_STORE });
}

// { version }: the notes for that version were dismissed, so it is seen on every device.
// The version shown, not the running one: the server may have been updated since.
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { version?: unknown } | null;
  const version = typeof body?.version === 'string' ? body.version : '';
  if (!parseSemver(version) || !parseSemver(APP_VERSION) || compareVersions(version, APP_VERSION) > 0) {
    return NextResponse.json({ error: 'Unknown version' }, { status: 400 });
  }
  await markWhatsNewSeen(auth.user.id, version);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

export const GET = withApiLogging(getHandler, 'api/whats-new');
export const POST = withApiLogging(postHandler, 'api/whats-new');
