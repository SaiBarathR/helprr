import type { JellyfinPlaybackReportBody } from '@/types/jellyfin';

export function normalizePlaybackPayload(body: Record<string, unknown>): JellyfinPlaybackReportBody {
  const playMethod = body.PlayMethod ?? body.playMethod;

  return {
    ItemId: String(body.ItemId ?? body.itemId ?? ''),
    SessionId: typeof (body.SessionId ?? body.sessionId) === 'string'
      ? String(body.SessionId ?? body.sessionId)
      : undefined,
    MediaSourceId: typeof (body.MediaSourceId ?? body.mediaSourceId) === 'string'
      ? String(body.MediaSourceId ?? body.mediaSourceId)
      : undefined,
    AudioStreamIndex: (body.AudioStreamIndex ?? body.audioStreamIndex) == null
      ? undefined
      : Number(body.AudioStreamIndex ?? body.audioStreamIndex),
    SubtitleStreamIndex: (body.SubtitleStreamIndex ?? body.subtitleStreamIndex) == null
      ? undefined
      : Number(body.SubtitleStreamIndex ?? body.subtitleStreamIndex),
    IsPaused: (body.IsPaused ?? body.isPaused) == null
      ? undefined
      : Boolean(body.IsPaused ?? body.isPaused),
    IsMuted: (body.IsMuted ?? body.isMuted) == null
      ? undefined
      : Boolean(body.IsMuted ?? body.isMuted),
    CanSeek: (body.CanSeek ?? body.canSeek) == null
      ? undefined
      : Boolean(body.CanSeek ?? body.canSeek),
    PositionTicks: (body.PositionTicks ?? body.positionTicks) == null
      ? undefined
      : Number(body.PositionTicks ?? body.positionTicks),
    PlaybackStartTimeTicks: (body.PlaybackStartTimeTicks ?? body.playbackStartTimeTicks) == null
      ? undefined
      : Number(body.PlaybackStartTimeTicks ?? body.playbackStartTimeTicks),
    VolumeLevel: (body.VolumeLevel ?? body.volumeLevel) == null
      ? undefined
      : Number(body.VolumeLevel ?? body.volumeLevel),
    PlayMethod:
      playMethod === 'DirectPlay' || playMethod === 'DirectStream' || playMethod === 'Transcode'
        ? playMethod
        : undefined,
    LiveStreamId: typeof (body.LiveStreamId ?? body.liveStreamId) === 'string'
      ? String(body.LiveStreamId ?? body.liveStreamId)
      : undefined,
    PlaySessionId: typeof (body.PlaySessionId ?? body.playSessionId) === 'string'
      ? String(body.PlaySessionId ?? body.playSessionId)
      : undefined,
    Failed: (body.Failed ?? body.failed) == null
      ? undefined
      : Boolean(body.Failed ?? body.failed),
  };
}
