import { isAxiosError } from 'axios';
import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinPlaybackContext } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { jellyfinConnectGateResponse, upstreamErrorResponse } from '@/lib/api-error';
import type { JellyfinPlayMethod, PlaybackProgressPayload } from '@/types/jellyfin-streaming';

const ITEM_ID_RE = /^[a-f0-9-]+$/i;

const EVENTS = new Set(['playing', 'progress', 'stopped']);
const PLAY_METHODS = new Set(['DirectPlay', 'DirectStream', 'Transcode']);

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const event = typeof body.event === 'string' ? body.event : '';
  const itemId = typeof body.itemId === 'string' ? body.itemId : '';
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  if (!EVENTS.has(event) || !ITEM_ID_RE.test(itemId) || !deviceId || deviceId.length > 128) {
    return NextResponse.json({ error: 'event, itemId, and deviceId are required' }, { status: 400 });
  }

  const playMethod = typeof body.playMethod === 'string' && PLAY_METHODS.has(body.playMethod)
    ? body.playMethod as JellyfinPlayMethod
    : undefined;

  const payload: PlaybackProgressPayload = {
    event: event as PlaybackProgressPayload['event'],
    deviceId,
    deviceName: typeof body.deviceName === 'string' ? body.deviceName.slice(0, 80) : 'Helprr',
    itemId,
    mediaSourceId: typeof body.mediaSourceId === 'string' ? body.mediaSourceId : undefined,
    playSessionId: typeof body.playSessionId === 'string' ? body.playSessionId : undefined,
    positionTicks: typeof body.positionTicks === 'number' ? Math.max(0, body.positionTicks) : 0,
    isPaused: body.isPaused === true,
    isMuted: body.isMuted === true,
    volumeLevel: typeof body.volumeLevel === 'number' ? Math.min(100, Math.max(0, body.volumeLevel)) : 100,
    playbackRate: typeof body.playbackRate === 'number' ? Math.min(4, Math.max(0.25, body.playbackRate)) : 1,
    playMethod,
    audioStreamIndex: typeof body.audioStreamIndex === 'number' ? body.audioStreamIndex : null,
    subtitleStreamIndex: typeof body.subtitleStreamIndex === 'number' ? body.subtitleStreamIndex : null,
    liveStreamId: typeof body.liveStreamId === 'string' ? body.liveStreamId : undefined,
    canSeek: body.canSeek !== false,
    repeatMode: body.repeatMode === 'RepeatAll' || body.repeatMode === 'RepeatOne' ? body.repeatMode : 'RepeatNone',
    shuffleMode: body.shuffleMode === 'Shuffle' ? 'Shuffle' : 'Sorted',
    playbackStartTimeTicks: typeof body.playbackStartTimeTicks === 'number' ? body.playbackStartTimeTicks : undefined,
    maxStreamingBitrate: typeof body.maxStreamingBitrate === 'number' ? body.maxStreamingBitrate : undefined,
  };

  try {
    const { client } = await getJellyfinPlaybackContext(auth.user);
    await client.reportPlayback(payload);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const gate = await jellyfinConnectGateResponse(auth.user, error);
    if (gate) return gate;
    // Progress is best-effort: a Jellyfin hiccup must not fail the player. Under
    // the member's own token these should succeed, so a rejection here is worth
    // seeing rather than suppressing.
    if (isAxiosError(error) && (error.response?.status === 400 || error.response?.status === 404)) {
      console.warn(
        `[api] Jellyfin rejected '${event}' playback reporting (${error.response.status}: ${error.message}).`,
      );
      return NextResponse.json({ ok: true, reported: false });
    }
    return upstreamErrorResponse(error, 'Failed to report playback');
  }
}

export const POST = withApiLogging(postHandler, 'api/jellyfin/stream/session');
