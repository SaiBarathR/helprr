'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import {
  buildPrimaryImageUrl,
  buildSubtitleUrl,
  buildTrickplayUrl,
  getItem,
  getNextEpisode,
  getSeriesEpisodes,
  getTicket,
  invalidateTicket,
  JellyfinPlaybackError,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
  stopEncoding,
  type OkTicket,
} from '@/lib/playback/api';
import {
  negotiate,
  pickSubtitleIndexForLanguage,
  secondsToTicks,
  ticksToSeconds,
  type ActivePlayback,
} from '@/lib/playback/player-machine';
import { attachSource, type PlaybackEngine } from '@/lib/playback/engine';
import { resolveTrickplay } from '@/lib/playback/trickplay';
import type {
  EpisodeSummary,
  PlayableItem,
  PlaybackProgressReport,
} from '@/types/jellyfin-playback';
import { PlayerControls } from '@/components/player/player-controls';
import type { EpisodePickerHandle } from '@/components/player/episode-panel';
import { NextUpOverlay } from '@/components/player/next-up-overlay';
import {
  diagnoseConnectivity,
  PlayerErrorScreen,
  type PlayerErrorKind,
} from '@/components/player/error-screen';

const PROGRESS_INTERVAL_MS = 10_000;
// The next-up countdown appears inside the last N seconds of an episode.
const NEXT_UP_THRESHOLD_SECONDS = 30;

type Phase = 'loading' | 'ready' | 'switching' | 'error';

interface TextTrack {
  url: string;
  lang?: string;
  label?: string;
}

function bufferedEndSeconds(video: HTMLVideoElement): number {
  const { buffered, currentTime } = video;
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= currentTime && currentTime <= buffered.end(i)) {
      return buffered.end(i);
    }
  }
  return buffered.length > 0 ? buffered.end(buffered.length - 1) : 0;
}

export function VideoPlayer({
  itemId,
  startTicks,
}: {
  itemId: string;
  /** Resume position; undefined falls back to the item's saved position. */
  startTicks?: number;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const ticketRef = useRef<OkTicket | null>(null);
  const activeRef = useRef<ActivePlayback | null>(null);
  const itemRef = useRef<PlayableItem | null>(null);
  // Seconds to seek to once metadata arrives (direct play resumes client-side).
  const pendingSeekRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
  // Once the user manually picks an audio track, keep direct play off so the
  // server can't silently revert to the file's default audio.
  const audioOverrideRef = useRef(false);
  // One automatic direct-play → transcode fallback per item, not a retry loop.
  const directPlayFailedRef = useRef(false);
  // Re-entrancy guard: a second switch while one is mid-negotiation would race
  // it (two PlaybackInfo sessions, an orphaned transcode).
  const switchingRef = useRef(false);
  // Mirrored into refs so the video-event handlers (onEnded) read fresh values.
  const nextEpisodeRef = useRef<EpisodeSummary | null>(null);
  const nextUpDismissedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<{ kind: PlayerErrorKind; message?: string } | null>(null);
  const [item, setItem] = useState<PlayableItem | null>(null);
  const [active, setActive] = useState<ActivePlayback | null>(null);
  const [textTrack, setTextTrack] = useState<TextTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [bufferedSeconds, setBufferedSeconds] = useState(0);
  const [nextEpisode, setNextEpisode] = useState<EpisodeSummary | null>(null);
  const [nextUpDismissed, setNextUpDismissed] = useState(false);
  const autoplayNext = useUIStore((s) => s.playerAutoplayNext);

  useEffect(() => {
    nextEpisodeRef.current = nextEpisode;
  }, [nextEpisode]);
  useEffect(() => {
    nextUpDismissedRef.current = nextUpDismissed;
  }, [nextUpDismissed]);

  const close = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.replace('/dashboard');
  }, [router]);

  const fail = useCallback((kind: PlayerErrorKind, message?: string) => {
    engineRef.current?.destroy();
    engineRef.current = null;
    setError({ kind, message });
    setPhase('error');
  }, []);

  const progressPayload = useCallback((): PlaybackProgressReport | null => {
    const a = activeRef.current;
    const video = videoRef.current;
    if (!a || !video) return null;
    return {
      ItemId: itemId,
      MediaSourceId: a.source.Id,
      PlaySessionId: a.playSessionId,
      PositionTicks: secondsToTicks(a.baseOffsetSeconds + video.currentTime),
      PlayMethod: a.playMethod,
      CanSeek: true,
      IsPaused: video.paused,
      AudioStreamIndex: a.audioStreamIndex,
      SubtitleStreamIndex: a.subtitleStreamIndex >= 0 ? a.subtitleStreamIndex : undefined,
      MaxStreamingBitrate: a.maxStreamingBitrate ?? undefined,
    };
  }, [itemId]);

  const reportProgress = useCallback(
    (eventName?: PlaybackProgressReport['EventName']) => {
      const ticket = ticketRef.current;
      const payload = progressPayload();
      if (!ticket || !payload) return;
      void reportPlaybackProgress(ticket, { ...payload, EventName: eventName }).catch(() => {});
    },
    [progressPayload]
  );

  /** Final stop report + transcode cleanup. Safe to call repeatedly. */
  const finalize = useCallback(() => {
    if (stoppedRef.current) return;
    const ticket = ticketRef.current;
    const a = activeRef.current;
    if (!ticket || !a) return;
    stoppedRef.current = true;
    reportPlaybackStopped(ticket, {
      ItemId: itemId,
      MediaSourceId: a.source.Id,
      PlaySessionId: a.playSessionId,
      PositionTicks: secondsToTicks(a.baseOffsetSeconds + (videoRef.current?.currentTime ?? 0)),
    });
    if (a.playMethod !== 'DirectPlay') {
      void stopEncoding(ticket, a.playSessionId).catch(() => {});
    }
  }, [itemId]);

  /** Point the <track> element at the active external text subtitle, if any. */
  const syncTextTrack = useCallback(
    (ticket: OkTicket, next: ActivePlayback) => {
      const stream = next.source.MediaStreams.find(
        (s) => s.Type === 'Subtitle' && s.Index === next.subtitleStreamIndex
      );
      if (stream && stream.DeliveryMethod === 'External') {
        setTextTrack({
          url: buildSubtitleUrl(ticket, itemId, next.source.Id, stream),
          lang: stream.Language,
          label: stream.DisplayTitle,
        });
      } else {
        setTextTrack(null);
      }
    },
    [itemId]
  );

  const attach = useCallback(
    async (ticket: OkTicket, next: ActivePlayback, seekToSeconds: number | null) => {
      const video = videoRef.current;
      if (!video) return;
      engineRef.current?.destroy();
      pendingSeekRef.current = seekToSeconds && seekToSeconds > 0 ? seekToSeconds : null;
      engineRef.current = await attachSource(video, next.url, next.isHls, (message) =>
        fail('playback', message)
      );
      activeRef.current = next;
      setActive(next);
      syncTextTrack(ticket, next);
      setCurrentSeconds(next.baseOffsetSeconds + (seekToSeconds ?? 0));
      setPhase('ready');
      void video.play().catch(() => {
        // Autoplay blocked (iOS without a gesture chain) — surface the play button.
        setPlaying(false);
      });
      const payload = progressPayload();
      if (payload) {
        void reportPlaybackStart(ticket, {
          ...payload,
          PositionTicks: secondsToTicks(next.baseOffsetSeconds + (seekToSeconds ?? 0)),
          IsPaused: false,
        }).catch(() => {});
      }
    },
    [fail, progressPayload, syncTextTrack]
  );

  const load = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const ticket = await getTicket();
      if (ticket.status !== 'ok') {
        setError({ kind: ticket.status === 'notLinked' ? 'notLinked' : 'needsRelink' });
        setPhase('error');
        return;
      }
      ticketRef.current = ticket as OkTicket;

      let playable: PlayableItem;
      try {
        playable = await getItem(ticket as OkTicket, itemId);
      } catch (err) {
        if (err instanceof JellyfinPlaybackError && err.status === 401) {
          setError({ kind: 'needsRelink' });
          setPhase('error');
          return;
        }
        if (err instanceof JellyfinPlaybackError) throw err;
        // Network-level failure: distinguish a stripped-CORS proxy from a dead server.
        const diagnosis = await diagnoseConnectivity((ticket as OkTicket).serverUrl);
        fail(diagnosis === 'cors' ? 'cors' : 'unreachable');
        return;
      }
      itemRef.current = playable;
      setItem(playable);

      // Resolve the autoplay target in the background (overlay + nexttrack).
      if (playable.Type === 'Episode' && playable.SeriesId) {
        void getNextEpisode(ticket as OkTicket, playable.SeriesId, itemId)
          .then(setNextEpisode)
          .catch(() => {});
      }

      const prefs = useUIStore.getState();
      const resumeTicks =
        startTicks ?? playable.UserData?.PlaybackPositionTicks ?? 0;
      const source = playable.MediaSources?.[0];
      const subtitleIndex = pickSubtitleIndexForLanguage(
        source?.MediaStreams,
        prefs.playerSubtitleLanguage
      );

      const next = await negotiate(ticket as OkTicket, itemId, {
        startTicks: resumeTicks,
        subtitleStreamIndex: subtitleIndex,
        maxStreamingBitrate: prefs.playerMaxBitrate,
      });
      await attach(
        ticket as OkTicket,
        next,
        next.playMethod === 'DirectPlay' ? ticksToSeconds(resumeTicks) : null
      );
    } catch (err) {
      if (err instanceof JellyfinPlaybackError && err.status === 401) {
        setError({ kind: 'needsRelink' });
        setPhase('error');
        return;
      }
      fail('playback', err instanceof Error ? err.message : undefined);
    }
  }, [attach, fail, itemId, startTicks]);

  /** Renegotiate (track/quality change or backward transcode seek) at a position. */
  const switchPlayback = useCallback(
    async (changes: {
      startSeconds?: number;
      audio?: number;
      subtitle?: number;
      bitrate?: number | null;
    }) => {
      const ticket = ticketRef.current;
      const a = activeRef.current;
      const video = videoRef.current;
      if (!ticket || !a || !video || switchingRef.current) return;
      switchingRef.current = true;
      const position =
        changes.startSeconds ?? a.baseOffsetSeconds + video.currentTime;
      setPhase('switching');
      try {
        if (a.playMethod !== 'DirectPlay') {
          await stopEncoding(ticket, a.playSessionId).catch(() => {});
        }
        if (changes.audio !== undefined) audioOverrideRef.current = true;
        const next = await negotiate(ticket, itemId, {
          startTicks: secondsToTicks(position),
          audioStreamIndex: changes.audio ?? a.audioStreamIndex,
          subtitleStreamIndex: changes.subtitle ?? a.subtitleStreamIndex,
          maxStreamingBitrate:
            changes.bitrate !== undefined ? changes.bitrate : a.maxStreamingBitrate,
          enableDirectPlay: !audioOverrideRef.current && !directPlayFailedRef.current,
        });
        await attach(
          ticket,
          next,
          next.playMethod === 'DirectPlay' ? position : null
        );
      } catch (err) {
        if (err instanceof JellyfinPlaybackError && err.status === 401) {
          setError({ kind: 'needsRelink' });
          setPhase('error');
          return;
        }
        fail('playback', err instanceof Error ? err.message : undefined);
      } finally {
        switchingRef.current = false;
      }
    },
    [attach, fail, itemId]
  );

  /** Advance to the next episode in place (autoplay, "Play now", nexttrack). */
  const goNext = useCallback(() => {
    const next = nextEpisodeRef.current;
    if (!next) return;
    finalize();
    router.replace(`/watch/${next.Id}`);
  }, [finalize, router]);

  /** Jump to any episode picked in the episode panel. */
  const selectEpisode = useCallback(
    (episodeId: string) => {
      if (episodeId === itemId) return;
      finalize();
      router.replace(`/watch/${episodeId}`);
    },
    [finalize, itemId, router]
  );

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  useEffect(() => {
    stoppedRef.current = false;
    audioOverrideRef.current = false;
    directPlayFailedRef.current = false;
    void load();
    const onPageHide = () => finalize();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      finalize();
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [load, finalize]);

  // Video element events drive UI state + event-based reports.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      const a = activeRef.current;
      if (!a) return;
      setCurrentSeconds(a.baseOffsetSeconds + video.currentTime);
      setBufferedSeconds(a.baseOffsetSeconds + bufferedEndSeconds(video));
    };
    const onLoadedMetadata = () => {
      if (pendingSeekRef.current !== null) {
        video.currentTime = pendingSeekRef.current;
        pendingSeekRef.current = null;
      }
    };
    const onPlay = () => {
      setPlaying(true);
      reportProgress('unpause');
    };
    const onPause = () => {
      setPlaying(false);
      reportProgress('pause');
    };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onSeeked = () => reportProgress('timeupdate');
    const onEnded = () => {
      finalize();
      if (
        nextEpisodeRef.current &&
        !nextUpDismissedRef.current &&
        useUIStore.getState().playerAutoplayNext
      ) {
        goNext();
      } else {
        close();
      }
    };
    const onError = () => {
      const a = activeRef.current;
      // A file the server thought was direct-playable but the browser rejects:
      // fall back to transcoding once instead of erroring out.
      if (a?.playMethod === 'DirectPlay' && !directPlayFailedRef.current) {
        directPlayFailedRef.current = true;
        void switchPlayback({ startSeconds: a.baseOffsetSeconds + video.currentTime });
        return;
      }
      if (activeRef.current) fail('playback', video.error?.message);
    };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };
  }, [close, fail, finalize, goNext, reportProgress, switchPlayback]);

  // 10s heartbeat keeps the JF dashboard session + resume position live.
  useEffect(() => {
    const timer = setInterval(() => {
      if (activeRef.current && !stoppedRef.current) reportProgress('timeupdate');
    }, PROGRESS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [reportProgress]);

  // External VTT tracks need an explicit nudge to 'showing' in some browsers.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !textTrack) return;
    const id = setTimeout(() => {
      if (video.textTracks.length > 0) video.textTracks[0].mode = 'showing';
    }, 0);
    return () => clearTimeout(id);
  }, [textTrack]);

  // ── Control callbacks ───────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  }, []);

  const seekTo = useCallback(
    (displaySeconds: number) => {
      const a = activeRef.current;
      const video = videoRef.current;
      if (!a || !video) return;
      const duration = itemRef.current?.RunTimeTicks
        ? ticksToSeconds(itemRef.current.RunTimeTicks)
        : a.baseOffsetSeconds + (video.duration || 0);
      const target = Math.min(Math.max(displaySeconds, 0), duration);
      if (a.playMethod === 'DirectPlay') {
        video.currentTime = target;
        return;
      }
      const streamTime = target - a.baseOffsetSeconds;
      if (streamTime >= 0) {
        // Within the transcode's timeline — the HLS playlist covers everything
        // from its offset forward, so the engine can seek natively.
        video.currentTime = streamTime;
      } else {
        // Before the transcode started — restart the encode at the new position.
        void switchPlayback({ startSeconds: target });
      }
    },
    [switchPlayback]
  );

  const skip = useCallback(
    (delta: number) => {
      const a = activeRef.current;
      const video = videoRef.current;
      if (!a || !video) return;
      seekTo(a.baseOffsetSeconds + video.currentTime + delta);
    },
    [seekTo]
  );

  const selectAudio = useCallback(
    (index: number) => {
      if (index === activeRef.current?.audioStreamIndex) return;
      void switchPlayback({ audio: index });
    },
    [switchPlayback]
  );

  const selectSubtitle = useCallback(
    (index: number) => {
      const ticket = ticketRef.current;
      const a = activeRef.current;
      if (!ticket || !a || index === a.subtitleStreamIndex) return;
      const streams = a.source.MediaStreams;
      const currentStream = streams.find(
        (s) => s.Type === 'Subtitle' && s.Index === a.subtitleStreamIndex
      );
      const nextStream =
        index === -1 ? null : streams.find((s) => s.Type === 'Subtitle' && s.Index === index);

      useUIStore
        .getState()
        .setPlayerSubtitleLanguage(index === -1 ? 'off' : nextStream?.Language ?? null);

      const burnedInNow = currentStream?.DeliveryMethod === 'Encode';
      if (!burnedInNow && (nextStream === null || nextStream?.DeliveryMethod === 'External')) {
        // Fast path: external text subs swap the <track> element — no renegotiation.
        const updated = { ...a, subtitleStreamIndex: index };
        activeRef.current = updated;
        setActive(updated);
        syncTextTrack(ticket, updated);
        reportProgress('timeupdate');
        return;
      }
      // Burn-in involved (turning it on or off) — the server must re-encode.
      void switchPlayback({ subtitle: index });
    },
    [reportProgress, switchPlayback, syncTextTrack]
  );

  const selectQuality = useCallback(
    (bitrate: number | null) => {
      if (bitrate === activeRef.current?.maxStreamingBitrate) return;
      useUIStore.getState().setPlayerMaxBitrate(bitrate);
      void switchPlayback({ bitrate });
    },
    [switchPlayback]
  );

  const toggleAutoplayNext = useCallback(() => {
    const store = useUIStore.getState();
    store.setPlayerAutoplayNext(!store.playerAutoplayNext);
  }, []);

  const durationSeconds = item?.RunTimeTicks ? ticksToSeconds(item.RunTimeTicks) : 0;

  // ── MediaSession (iOS lock screen / control center) ────────────────────────

  useEffect(() => {
    if (!('mediaSession' in navigator) || !item) return;
    const ticket = ticketRef.current;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.Name,
      artist: item.SeriesName ?? '',
      album: item.SeasonName ?? '',
      // Series poster for episodes — the episode's own Primary is a still frame.
      artwork: ticket
        ? [{ src: buildPrimaryImageUrl(ticket, item.SeriesId ?? item.Id), sizes: '512x512' }]
        : [],
    });
    return () => {
      navigator.mediaSession.metadata = null;
    };
  }, [item]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [playing]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => {
      void videoRef.current?.play().catch(() => {});
    });
    ms.setActionHandler('pause', () => videoRef.current?.pause());
    ms.setActionHandler('seekbackward', () => skip(-10));
    ms.setActionHandler('seekforward', () => skip(10));
    ms.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined && details.seekTime !== null) seekTo(details.seekTime);
    });
    ms.setActionHandler('nexttrack', nextEpisode ? () => goNext() : null);
    return () => {
      const actions: MediaSessionAction[] = [
        'play',
        'pause',
        'seekbackward',
        'seekforward',
        'seekto',
        'nexttrack',
      ];
      actions.forEach((action) => ms.setActionHandler(action, null));
    };
  }, [goNext, nextEpisode, seekTo, skip]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (durationSeconds > 0) {
      navigator.mediaSession.setPositionState({
        duration: durationSeconds,
        position: Math.min(currentSeconds, durationSeconds),
        playbackRate: 1,
      });
    }
  }, [currentSeconds, durationSeconds]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const chapters = useMemo(
    () =>
      (item?.Chapters ?? []).map((c) => ({
        name: c.Name,
        seconds: ticksToSeconds(c.StartPositionTicks),
      })),
    [item]
  );

  const trickplay = useMemo(() => {
    const ticket = ticketRef.current;
    if (!ticket || !item || !active) return null;
    const info = resolveTrickplay(item, active.source.Id);
    if (!info) return null;
    return {
      info,
      urlForTile: (tileIndex: number) =>
        buildTrickplayUrl(ticket, item.Id, info.Width, tileIndex, active.source.Id),
    };
  }, [item, active]);

  const episodePicker = useMemo<EpisodePickerHandle | null>(() => {
    const ticket = ticketRef.current;
    if (!ticket || !item || item.Type !== 'Episode' || !item.SeriesId) return null;
    const seriesId = item.SeriesId;
    return {
      seriesName: item.SeriesName,
      currentId: item.Id,
      load: () => getSeriesEpisodes(ticket, seriesId),
      imageUrl: (episodeId) => buildPrimaryImageUrl(ticket, episodeId, 320),
      onSelect: selectEpisode,
    };
  }, [item, selectEpisode]);

  if (phase === 'error' && error) {
    return (
      <PlayerErrorScreen
        kind={error.kind}
        message={error.message}
        onRetry={() => void load()}
        onClose={close}
        onRelinked={() => {
          invalidateTicket();
          void load();
        }}
      />
    );
  }

  const remainingSeconds = durationSeconds - currentSeconds;
  const showNextUp =
    phase === 'ready' &&
    nextEpisode !== null &&
    !nextUpDismissed &&
    autoplayNext &&
    durationSeconds > 0 &&
    remainingSeconds > 0 &&
    remainingSeconds <= NEXT_UP_THRESHOLD_SECONDS;

  const subtitle =
    item?.Type === 'Episode'
      ? [
          item.SeriesName,
          item.ParentIndexNumber !== undefined && item.IndexNumber !== undefined
            ? `S${item.ParentIndexNumber}:E${item.IndexNumber}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : item?.ProductionYear?.toString();

  return (
    <div ref={containerRef} className="relative h-full w-full bg-black">
      {/* crossOrigin is required for cross-origin <track> subtitles; Jellyfin
          serves CORS headers by default. */}
      <video
        ref={videoRef}
        className="h-full w-full"
        playsInline
        crossOrigin="anonymous"
        poster=""
      >
        {textTrack && (
          <track
            key={textTrack.url}
            kind="subtitles"
            src={textTrack.url}
            srcLang={textTrack.lang}
            label={textTrack.label}
            default
          />
        )}
      </video>

      {phase === 'loading' ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-12 w-12 animate-spin text-white/80" aria-hidden />
        </div>
      ) : (
        <PlayerControls
          title={item?.Name ?? ''}
          subtitle={subtitle ?? undefined}
          playing={playing}
          buffering={buffering}
          switching={phase === 'switching'}
          currentSeconds={currentSeconds}
          durationSeconds={durationSeconds}
          bufferedSeconds={bufferedSeconds}
          source={active?.source ?? null}
          audioStreamIndex={active?.audioStreamIndex}
          subtitleStreamIndex={active?.subtitleStreamIndex ?? -1}
          maxBitrate={active?.maxStreamingBitrate ?? null}
          chapters={chapters}
          trickplay={trickplay}
          episodePicker={episodePicker}
          autoplayNext={item?.Type === 'Episode' ? autoplayNext : undefined}
          videoEl={videoRef.current}
          containerEl={containerRef.current}
          onTogglePlay={togglePlay}
          onSeekTo={seekTo}
          onSkip={skip}
          onClose={close}
          onSelectAudio={selectAudio}
          onSelectSubtitle={selectSubtitle}
          onSelectQuality={selectQuality}
          onToggleAutoplayNext={item?.Type === 'Episode' ? toggleAutoplayNext : undefined}
        />
      )}

      {showNextUp && nextEpisode && (
        <NextUpOverlay
          episode={nextEpisode}
          secondsRemaining={remainingSeconds}
          onPlayNow={goNext}
          onDismiss={() => setNextUpDismissed(true)}
        />
      )}
    </div>
  );
}
