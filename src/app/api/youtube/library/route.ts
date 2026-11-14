import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { libraryStatusResponse, linkLibrary } from '@/lib/archive/library-route';
import { getYoutubeSettings } from '@/lib/youtube/settings';
import { recordSettingsUpdated } from '@/lib/security-audit';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.manage');
  if (!auth.ok) return auth.response;

  return libraryStatusResponse((await getYoutubeSettings()).jellyfinLibraryPath);
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.manage');
  if (!auth.ok) return auth.response;

  return linkLibrary(request, async (data) => {
    await getYoutubeSettings();
    await prisma.youtubeSettings.update({ where: { id: 'singleton' }, data });
    await recordSettingsUpdated(request, auth.user, 'YouTube library', Object.keys(data));
  });
}

export const GET = withApiLogging(getHandler, 'api/youtube/library');
export const POST = withApiLogging(postHandler, 'api/youtube/library');
