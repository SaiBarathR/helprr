import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import type {
  JellyfinMediaSource,
  JellyfinMediaStream,
  JellyfinPlaybackTrackOption,
  JellyfinPlaybackQualityOption,
} from '@/types/jellyfin';

function pickSource(
  sources: JellyfinMediaSource[],
  preferredMediaSourceId?: string,
): JellyfinMediaSource | null {
  if (!sources.length) return null;
  if (preferredMediaSourceId) {
    const requested = sources.find((source) => source.Id === preferredMediaSourceId);
    if (requested) return requested;
  }

  const scored = [...sources].sort((a, b) => {
    const scoreA =
      (a.SupportsDirectPlay ? 300 : 0) +
      (a.SupportsDirectStream ? 200 : 0) +
      (a.SupportsTranscoding ? 100 : 0);
    const scoreB =
      (b.SupportsDirectPlay ? 300 : 0) +
      (b.SupportsDirectStream ? 200 : 0) +
      (b.SupportsTranscoding ? 100 : 0);
    return scoreB - scoreA;
  });

  return scored[0];
}

function audioTrackLabel(stream: JellyfinMediaStream): string {
  const pieces = [stream.DisplayTitle, stream.Title, stream.Language, stream.Codec]
    .filter(Boolean)
    .map((value) => value!.trim());
  if (!pieces.length) {
    return `Audio ${stream.Index}`;
  }
  return pieces[0];
}

function subtitleTrackLabel(stream: JellyfinMediaStream): string {
  const pieces = [stream.DisplayTitle, stream.Title, stream.Language, stream.Codec]
    .filter(Boolean)
    .map((value) => value!.trim());
  if (!pieces.length) {
    return `Subtitle ${stream.Index}`;
  }
  return pieces[0];
}

function qualityLabel(source: JellyfinMediaSource): string {
  const parts: string[] = [];
  if (source.Name) parts.push(source.Name);
  if (source.Container) parts.push(source.Container.toUpperCase());
  if (source.Bitrate) {
    parts.push(`${(source.Bitrate / 1_000_000).toFixed(1)} Mbps`);
  }

  if (source.SupportsDirectPlay) parts.push('Direct');
  else if (source.SupportsDirectStream) parts.push('Direct Stream');
  else if (source.SupportsTranscoding) parts.push('Transcode');

  return parts.join(' • ') || source.Id;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const itemId: string | undefined = body.itemId;
    const mediaSourceId: string | undefined = body.mediaSourceId;
    const audioStreamIndex: number | undefined =
      body.audioStreamIndex == null ? undefined : Number(body.audioStreamIndex);
    const subtitleStreamIndex: number | undefined =
      body.subtitleStreamIndex == null ? undefined : Number(body.subtitleStreamIndex);
    const maxStreamingBitrate: number | undefined =
      body.maxStreamingBitrate == null ? undefined : Number(body.maxStreamingBitrate);
    const requestedStartTimeTicks: number | undefined =
      body.startTimeTicks == null ? undefined : Number(body.startTimeTicks);

    if (!itemId) {
      return NextResponse.json({ error: 'itemId is required' }, { status: 400 });
    }

    const client = await getJellyfinClient();
    const item = await client.getItem(itemId);
    const startTimeTicks =
      requestedStartTimeTicks != null ? requestedStartTimeTicks : item.UserData?.PlaybackPositionTicks || 0;

    const playbackInfo = await client.getPlaybackInfo(itemId, {
      UserId: client.getUserId(),
      StartTimeTicks: startTimeTicks,
      IsPlayback: true,
      AutoOpenLiveStream: true,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
      ...(mediaSourceId ? { MediaSourceId: mediaSourceId } : {}),
      ...(audioStreamIndex != null ? { AudioStreamIndex: audioStreamIndex } : {}),
      ...(subtitleStreamIndex != null ? { SubtitleStreamIndex: subtitleStreamIndex } : {}),
      ...(maxStreamingBitrate ? { MaxStreamingBitrate: maxStreamingBitrate } : {}),
    });

    const source = pickSource(playbackInfo.MediaSources || [], mediaSourceId);
    if (!source) {
      return NextResponse.json(
        { error: 'No playable media source returned by Jellyfin' },
        { status: 404 },
      );
    }

    const stream = client.buildStreamUrl(itemId, source, {
      playSessionId: playbackInfo.PlaySessionId,
      startTimeTicks,
      maxStreamingBitrate,
    });

    const audioTracks: JellyfinPlaybackTrackOption[] = (source.MediaStreams || [])
      .filter((streamEntry) => streamEntry.Type === 'Audio')
      .map((streamEntry) => ({
        index: streamEntry.Index,
        label: audioTrackLabel(streamEntry),
        language: streamEntry.Language,
        codec: streamEntry.Codec,
        isDefault: streamEntry.Index === source.DefaultAudioStreamIndex,
      }));

    const subtitleTracks: JellyfinPlaybackTrackOption[] = (source.MediaStreams || [])
      .filter((streamEntry) => streamEntry.Type === 'Subtitle')
      .map((streamEntry) => ({
        index: streamEntry.Index,
        label: subtitleTrackLabel(streamEntry),
        language: streamEntry.Language,
        codec: streamEntry.Codec,
        isDefault: streamEntry.Index === source.DefaultSubtitleStreamIndex,
        isExternal: streamEntry.IsExternal,
        url: client.buildSubtitleUrl(streamEntry.DeliveryUrl) || undefined,
      }));

    const qualityOptions: JellyfinPlaybackQualityOption[] = (playbackInfo.MediaSources || []).map(
      (candidate) => ({
        id: candidate.Id,
        label: qualityLabel(candidate),
        mediaSourceId: candidate.Id,
        estimatedBitrate: candidate.Bitrate,
        supportsDirectPlay: candidate.SupportsDirectPlay,
        supportsDirectStream: candidate.SupportsDirectStream,
        supportsTranscoding: candidate.SupportsTranscoding,
      }),
    );

    return NextResponse.json({
      item,
      streamUrl: stream.url,
      mimeType: stream.mimeType,
      isHls: stream.isHls,
      playMethod: stream.playMethod,
      playSessionId: stream.playSessionId,
      mediaSourceId: source.Id,
      liveStreamId: source.LiveStreamId ?? null,
      runtimeTicks: source.RunTimeTicks ?? item.RunTimeTicks ?? null,
      startTimeTicks,
      audioTracks,
      subtitleTracks,
      qualityOptions,
      defaultAudioStreamIndex: source.DefaultAudioStreamIndex ?? null,
      defaultSubtitleStreamIndex: source.DefaultSubtitleStreamIndex ?? null,
      transcodeReasons: source.TranscodeReasons || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch playback info';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
