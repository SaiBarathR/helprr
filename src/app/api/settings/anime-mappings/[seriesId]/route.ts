import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

// Reset one series' mapping (entries cascade). The series re-auto-matches the
// next time someone views it. deleteMany keeps this idempotent.
async function deleteHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ seriesId: string }> }
): Promise<NextResponse> {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { seriesId } = await params;
  const sonarrSeriesId = Number(seriesId);
  if (!Number.isFinite(sonarrSeriesId) || sonarrSeriesId <= 0) {
    return NextResponse.json({ error: 'Invalid series ID' }, { status: 400 });
  }

  // A series id is only unique within a Sonarr instance, so scope the reset to the
  // requested instance when given; without it, fall back to all instances (legacy).
  const instanceId = _request.nextUrl.searchParams.get('instanceId') ?? undefined;
  const result = await prisma.aniListSeriesMapping.deleteMany({
    where: instanceId ? { sonarrSeriesId, sonarrInstanceId: instanceId } : { sonarrSeriesId },
  });
  return NextResponse.json({ deleted: result.count });
}

export const DELETE = withApiLogging(deleteHandler, 'api/settings/anime-mappings/[seriesId]');
