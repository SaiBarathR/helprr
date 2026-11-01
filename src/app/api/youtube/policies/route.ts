import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { layerMap, sanitizeLayer } from '@/lib/archive/policy';
import { prisma } from '@/lib/db';
import { YOUTUBE } from '@/lib/youtube/platform';
import { YOUTUBE_BUILT_IN_POLICY } from '@/lib/youtube/policy';
import { getYoutubeSettings } from '@/lib/youtube/settings';

const json = (value: unknown) => value as Prisma.InputJsonValue;

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.manage');
  if (!auth.ok) return auth.response;

  const channelId = request.nextUrl.searchParams.get('channelId');
  const settings = await getYoutubeSettings();
  const stored = channelId
    ? await prisma.creatorPolicy.findUnique({ where: { creatorId: channelId, creator: { platform: YOUTUBE } } })
    : null;
  return NextResponse.json({
    builtIn: YOUTUBE_BUILT_IN_POLICY,
    defaultPolicy: sanitizeLayer(settings.defaultPolicy),
    typePolicies: layerMap(settings.typePolicies),
    channel: stored ? { policy: sanitizeLayer(stored.policy), typePolicies: layerMap(stored.typePolicies) } : null,
  });
}

async function putHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  if (typeof body.channelId === 'string') {
    const channel = await prisma.creator.findUnique({ where: { id: body.channelId, platform: YOUTUBE }, select: { id: true } });
    if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    const data = { policy: json(sanitizeLayer(body.policy)), typePolicies: json(layerMap(body.typePolicies)) };
    await prisma.creatorPolicy.upsert({ where: { creatorId: channel.id }, update: data, create: { creatorId: channel.id, ...data } });
  } else {
    await getYoutubeSettings();
    await prisma.youtubeSettings.update({
      where: { id: 'singleton' },
      data: { defaultPolicy: json(sanitizeLayer(body.defaultPolicy)), typePolicies: json(layerMap(body.typePolicies)) },
    });
  }
  return NextResponse.json({ ok: true });
}

export const GET = withApiLogging(getHandler, 'api/youtube/policies');
export const PUT = withApiLogging(putHandler, 'api/youtube/policies');
