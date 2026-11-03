import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { libraryStatusResponse, linkLibrary } from '@/lib/archive/library-route';
import { getTwitchSettings } from '@/lib/twitch/settings';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  return libraryStatusResponse((await getTwitchSettings()).jellyfinLibraryPath);
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  return linkLibrary(request, async (data) => {
    await getTwitchSettings();
    await prisma.archiveSettings.update({ where: { id: 'singleton' }, data });
  });
}

export const GET = withApiLogging(getHandler, 'api/twitch/library');
export const POST = withApiLogging(postHandler, 'api/twitch/library');
