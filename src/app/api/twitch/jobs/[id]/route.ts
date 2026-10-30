import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { JOB_SELECT, serializeJob } from '@/lib/twitch/serialize-job';

type RouteContext = { params: Promise<{ id: string }> };

async function getHandler(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const job = await prisma.twitchJob.findUnique({ where: { id }, select: JOB_SELECT });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  return NextResponse.json(serializeJob(job));
}

async function patchHandler(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { priority?: unknown } | null;
  if (typeof body?.priority !== 'number' || !Number.isInteger(body.priority) || Math.abs(body.priority) > 1000) {
    return NextResponse.json({ error: 'priority must be a whole number' }, { status: 400 });
  }
  const { id } = await params;
  const { count } = await prisma.twitchJob.updateMany({ where: { id }, data: { priority: body.priority } });
  if (count === 0) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export const GET = withApiLogging(getHandler, 'api/twitch/jobs/[id]');
export const PATCH = withApiLogging(patchHandler, 'api/twitch/jobs/[id]');
