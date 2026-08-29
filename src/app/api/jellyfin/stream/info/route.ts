import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinPlaybackContext } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { jellyfinConnectGateResponse, upstreamErrorResponse } from '@/lib/api-error';
import { buildHelprrStreamInfo } from '@/lib/jellyfin-playback/stream-info';
import type { JellyfinDeviceProfile, PlaybackInfoRequest } from '@/types/jellyfin-streaming';

const ITEM_ID_RE = /^[a-f0-9-]+$/i;

function isDeviceProfile(value: unknown): value is JellyfinDeviceProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as JellyfinDeviceProfile;
  return Array.isArray(profile.DirectPlayProfiles)
    && Array.isArray(profile.TranscodingProfiles)
    && Array.isArray(profile.SubtitleProfiles);
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const itemId = typeof body.itemId === 'string' ? body.itemId : '';
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  if (!ITEM_ID_RE.test(itemId) || !deviceId || deviceId.length > 128) {
    return NextResponse.json({ error: 'itemId and deviceId are required' }, { status: 400 });
  }
  if (!isDeviceProfile(body.deviceProfile)) {
    return NextResponse.json({ error: 'deviceProfile is required' }, { status: 400 });
  }

  const startTimeTicks = typeof body.startTimeTicks === 'number' ? Math.max(0, body.startTimeTicks) : 0;
  const maxStreamingBitrate = typeof body.maxStreamingBitrate === 'number' && body.maxStreamingBitrate > 0
    ? Math.min(body.maxStreamingBitrate, 120_000_000)
    : undefined;

  const playbackRequest: PlaybackInfoRequest = {
    itemId,
    deviceId,
    deviceName: typeof body.deviceName === 'string' ? body.deviceName.slice(0, 80) : 'Helprr',
    startTimeTicks,
    maxStreamingBitrate,
    audioStreamIndex: typeof body.audioStreamIndex === 'number' ? body.audioStreamIndex : body.audioStreamIndex === null ? null : undefined,
    subtitleStreamIndex: typeof body.subtitleStreamIndex === 'number' ? body.subtitleStreamIndex : body.subtitleStreamIndex === null ? null : undefined,
    mediaSourceId: typeof body.mediaSourceId === 'string' ? body.mediaSourceId : undefined,
    liveStreamId: typeof body.liveStreamId === 'string' ? body.liveStreamId : undefined,
    enableDirectPlay: typeof body.enableDirectPlay === 'boolean' ? body.enableDirectPlay : undefined,
    enableDirectStream: typeof body.enableDirectStream === 'boolean' ? body.enableDirectStream : undefined,
    isPlayback: true,
    deviceProfile: body.deviceProfile,
    alwaysBurnInSubtitleWhenTranscoding: body.alwaysBurnInSubtitleWhenTranscoding === true,
  };

  try {
    const { client } = await getJellyfinPlaybackContext(auth.user);
    const [item, playback] = await Promise.all([
      client.getItem(itemId),
      client.getPlaybackInfo(playbackRequest),
    ]);
    const stream = buildHelprrStreamInfo({
      item,
      playback,
      mediaSourceId: playbackRequest.mediaSourceId,
      startTimeTicks,
    });
    if ('error' in stream) {
      return NextResponse.json({ error: stream.error }, { status: 409 });
    }
    return NextResponse.json(stream);
  } catch (error) {
    const gate = await jellyfinConnectGateResponse(auth.user, error);
    if (gate) return gate;
    return upstreamErrorResponse(error, 'Failed to start playback');
  }
}

export const POST = withApiLogging(postHandler, 'api/jellyfin/stream/info');
