import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { parsePageParams } from '@/lib/pagination';
import { buildFileWhere, listFiles, serializeFile } from '@/lib/archive/files';
import { loadPlayedDates } from '@/lib/archive/retention';
import { TWITCH } from '@/lib/twitch/platform';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip, take } = parsePageParams(searchParams, { defaultSize: 30, maxSize: 60 });
  const where = buildFileWhere(searchParams, TWITCH);
  const [files, total] = await Promise.all([
    listFiles(where, TWITCH, searchParams.get('sort'), skip, take),
    prisma.archiveMediaFile.count({ where }),
  ]);
  const played = await loadPlayedDates(auth.user, files.flatMap((file) => file.jellyfinItemId ?? []));
  return NextResponse.json({
    files: files.map((file) => serializeFile(file, file.jellyfinItemId ? played.get(file.jellyfinItemId) : undefined)),
    total,
    page,
    pageSize,
  });
}

export const GET = withApiLogging(getHandler, 'api/twitch/files');
