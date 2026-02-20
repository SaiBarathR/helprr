'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Play, Pause, SkipForward } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type {
  JellyfinItem,
  JellyfinPlaybackQualityOption,
  JellyfinPlaybackTrackOption,
} from '@/types/jellyfin';

interface PlaybackInfoPayload {
  item: JellyfinItem;
  streamUrl: string;
  mimeType: string;
  isHls: boolean;
  playMethod: 'Transcode' | 'DirectStream' | 'DirectPlay';
  playSessionId: string;
  mediaSourceId: string;
  liveStreamId?: string | null;
  runtimeTicks?: number | null;
  startTimeTicks: number;
  audioTracks: JellyfinPlaybackTrackOption[];
  subtitleTracks: JellyfinPlaybackTrackOption[];
  qualityOptions: JellyfinPlaybackQualityOption[];
  defaultAudioStreamIndex?: number | null;
  defaultSubtitleStreamIndex?: number | null;
  transcodeReasons?: string[];
}

const REPORT_INTERVAL_MS = 10000;
const NEXT_EPISODE_COUNTDOWN = 6;

function ticksToSeconds(ticks: number): number {
  return ticks / 10_000_000;
}

function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.floor(seconds * 10_000_000));
}

function normalizeTitleCase(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function formatBitrate(bitrate?: number): string {
  if (!bitrate) return 'Auto';
  return `${(bitrate / 1_000_000).toFixed(1)} Mbps`;
}

function WatchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const resumeAfterReloadRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resolvedItemId, setResolvedItemId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackInfoPayload | null>(null);

  const [selectedAudioIndex, setSelectedAudioIndex] = useState<number | null>(null);
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState<number | null>(null);
  const [selectedQualityId, setSelectedQualityId] = useState<string | null>(null);
  const [maxStreamingBitrate, setMaxStreamingBitrate] = useState<number | null>(null);

  const [hasStarted, setHasStarted] = useState(false);
  const [autoplayNextEpisode, setAutoplayNextEpisode] = useState(true);
  const [nextEpisode, setNextEpisode] = useState<JellyfinItem | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const playbackStartTicksRef = useRef<number>(Date.now() * 10_000);
  const playbackRef = useRef<PlaybackInfoPayload | null>(null);
  const selectedAudioRef = useRef<number | null>(null);
  const selectedSubtitleRef = useRef<number | null>(null);
  const selectedQualityRef = useRef<string | null>(null);
  const maxStreamingBitrateRef = useRef<number | null>(null);

  const resolveQuery = useMemo(() => {
    const allowedKeys = [
      'type',
      'tmdbId',
      'tvdbId',
      'imdbId',
      'title',
      'seriesTitle',
      'year',
      'seasonNumber',
      'episodeNumber',
      'episodeTitle',
    ];

    const params = new URLSearchParams();
    for (const key of allowedKeys) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }

    return params.toString();
  }, [searchParams]);
  const directItemId = searchParams.get('itemId');
  const directStartTimeTicks = Number(searchParams.get('startTimeTicks') || 0);

  const getCurrentPositionTicks = useCallback(() => {
    const video = videoRef.current;
    if (!video || Number.isNaN(video.currentTime)) return 0;
    return secondsToTicks(video.currentTime);
  }, []);

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => {
    selectedAudioRef.current = selectedAudioIndex;
  }, [selectedAudioIndex]);

  useEffect(() => {
    selectedSubtitleRef.current = selectedSubtitleIndex;
  }, [selectedSubtitleIndex]);

  useEffect(() => {
    selectedQualityRef.current = selectedQualityId;
  }, [selectedQualityId]);

  useEffect(() => {
    maxStreamingBitrateRef.current = maxStreamingBitrate;
  }, [maxStreamingBitrate]);

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/settings', { cache: 'no-store' });
      if (!response.ok) return;
      const settings = await response.json();
      setAutoplayNextEpisode(settings?.autoplayNextEpisode ?? true);
    } catch {
      // Keep default value.
    }
  }, []);

  const loadNextEpisode = useCallback(async (itemId: string) => {
    try {
      const response = await fetch(`/api/jellyfin/next?itemId=${encodeURIComponent(itemId)}`);
      if (!response.ok) {
        setNextEpisode(null);
        return;
      }
      const data = await response.json();
      setNextEpisode(data.item || null);
    } catch {
      setNextEpisode(null);
    }
  }, []);

  const sendPlaybackReport = useCallback(
    async (kind: 'start' | 'progress' | 'stop', opts?: { keepalive?: boolean; failed?: boolean }) => {
      const activePlayback = playbackRef.current;
      if (!activePlayback) return;
      const video = videoRef.current;
      if (!video) return;

      const payload = {
        itemId: activePlayback.item.Id,
        mediaSourceId: activePlayback.mediaSourceId,
        playSessionId: activePlayback.playSessionId,
        audioStreamIndex: selectedAudioRef.current ?? undefined,
        subtitleStreamIndex: selectedSubtitleRef.current ?? undefined,
        isPaused: video.paused,
        isMuted: video.muted,
        canSeek: true,
        positionTicks: getCurrentPositionTicks(),
        playbackStartTimeTicks: playbackStartTicksRef.current,
        volumeLevel: Math.round(video.volume * 100),
        playMethod: activePlayback.playMethod,
        liveStreamId: activePlayback.liveStreamId || undefined,
        failed: opts?.failed,
      };

      const path =
        kind === 'start'
          ? '/api/jellyfin/playback/start'
          : kind === 'progress'
            ? '/api/jellyfin/playback/progress'
            : '/api/jellyfin/playback/stop';

      try {
        await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: opts?.keepalive,
        });
      } catch {
        // Reporting failures should not interrupt playback.
      }
    },
    [getCurrentPositionTicks],
  );

  const fetchPlaybackInfo = useCallback(
    async (
      itemId: string,
      overrides?: {
        mediaSourceId?: string | null;
        audioStreamIndex?: number | null;
        subtitleStreamIndex?: number | null;
        startTimeTicks?: number;
        maxStreamingBitrate?: number | null;
      },
    ) => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/jellyfin/playback-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId,
            mediaSourceId: overrides?.mediaSourceId ?? selectedQualityRef.current,
            audioStreamIndex:
              overrides?.audioStreamIndex ??
              selectedAudioRef.current ??
              playbackRef.current?.defaultAudioStreamIndex ??
              undefined,
            subtitleStreamIndex:
              overrides?.subtitleStreamIndex ??
              selectedSubtitleRef.current ??
              playbackRef.current?.defaultSubtitleStreamIndex ??
              undefined,
            startTimeTicks:
              overrides?.startTimeTicks ??
              getCurrentPositionTicks() ??
              playbackRef.current?.startTimeTicks ??
              0,
            maxStreamingBitrate:
              overrides?.maxStreamingBitrate ?? maxStreamingBitrateRef.current ?? undefined,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: 'Playback setup failed' }));
          throw new Error(data.error || 'Playback setup failed');
        }

        const data: PlaybackInfoPayload = await response.json();
        setPlayback(data);
        setSelectedQualityId(data.mediaSourceId);
        setSelectedAudioIndex(
          data.defaultAudioStreamIndex ?? data.audioTracks[0]?.index ?? null,
        );
        setSelectedSubtitleIndex(
          data.defaultSubtitleStreamIndex ?? null,
        );
        setHasStarted(false);
        setCountdown(null);
        await loadNextEpisode(data.item.Id);
      } catch (fetchError) {
        const message = fetchError instanceof Error ? fetchError.message : 'Failed to load playback';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [getCurrentPositionTicks, loadNextEpisode],
  );

  useEffect(() => {
    let cancelled = false;

    async function resolveTarget() {
      setResolving(true);
      setLoading(true);
      setError(null);

      try {
        if (directItemId) {
          if (cancelled) return;
          setResolvedItemId(directItemId);
          await fetchPlaybackInfo(directItemId, {
            startTimeTicks: directStartTimeTicks,
          });
          return;
        }

        if (!resolveQuery) {
          throw new Error('No playback target provided');
        }

        const response = await fetch(`/api/jellyfin/resolve?${resolveQuery}`);
        if (!response.ok) {
          const data = await response.json().catch(() => ({ error: 'Failed to resolve Jellyfin item' }));
          throw new Error(data.error || 'Failed to resolve Jellyfin item');
        }

        const data = await response.json();
        const match = data.match;
        if (!match?.itemId) {
          throw new Error('No matching Jellyfin item found');
        }

        if (cancelled) return;
        setResolvedItemId(match.itemId);
        await fetchPlaybackInfo(match.itemId);
      } catch (resolveError) {
        if (cancelled) return;
        const message = resolveError instanceof Error ? resolveError.message : 'Failed to resolve playback item';
        setError(message);
        setLoading(false);
      } finally {
        if (!cancelled) {
          setResolving(false);
        }
      }
    }

    resolveTarget();

    return () => {
      cancelled = true;
    };
  }, [directItemId, directStartTimeTicks, fetchPlaybackInfo, resolveQuery]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playback) return;

    resumeAfterReloadRef.current = resumeAfterReloadRef.current || false;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    video.pause();
    video.removeAttribute('src');
    video.load();

    const onLoadedMetadata = () => {
      const startSeconds = ticksToSeconds(playback.startTimeTicks || 0);
      if (startSeconds > 0 && Number.isFinite(startSeconds)) {
        try {
          video.currentTime = startSeconds;
        } catch {
          // Ignore invalid seek values.
        }
      }

      if (resumeAfterReloadRef.current) {
        void video.play().catch(() => {
          // User gesture may be required; ignore.
        });
      }
      resumeAfterReloadRef.current = false;
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);

    if (playback.isHls) {
      const canPlayNativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';
      if (canPlayNativeHls) {
        video.src = playback.streamUrl;
      } else if (Hls.isSupported()) {
        const hls = new Hls();
        hlsRef.current = hls;
        hls.loadSource(playback.streamUrl);
        hls.attachMedia(video);
      } else {
        setError('This browser cannot play HLS streams.');
      }
    } else {
      video.src = playback.streamUrl;
    }

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [playback]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playback) return;

    const onPlay = () => {
      if (!hasStarted) {
        playbackStartTicksRef.current = Date.now() * 10_000;
        setHasStarted(true);
        void sendPlaybackReport('start');
      } else {
        void sendPlaybackReport('progress');
      }
    };

    const onPause = () => {
      if (hasStarted) {
        void sendPlaybackReport('progress');
      }
    };

    const onSeeked = () => {
      if (hasStarted) {
        void sendPlaybackReport('progress');
      }
    };

    const onEnded = () => {
      if (hasStarted) {
        void sendPlaybackReport('stop');
      }
      if (autoplayNextEpisode && nextEpisode) {
        setCountdown(NEXT_EPISODE_COUNTDOWN);
      }
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ended', onEnded);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ended', onEnded);
    };
  }, [autoplayNextEpisode, hasStarted, nextEpisode, playback, sendPlaybackReport]);

  useEffect(() => {
    if (!hasStarted) return;

    const timer = setInterval(() => {
      void sendPlaybackReport('progress');
    }, REPORT_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [hasStarted, sendPlaybackReport]);

  useEffect(() => {
    if (countdown == null) return;
    if (!nextEpisode) {
      setCountdown(null);
      return;
    }

    if (countdown <= 0) {
      router.replace(`/watch?itemId=${encodeURIComponent(nextEpisode.Id)}`);
      return;
    }

    const timeout = setTimeout(() => {
      setCountdown((prev) => (prev == null ? null : prev - 1));
    }, 1000);

    return () => clearTimeout(timeout);
  }, [countdown, nextEpisode, router]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (hasStarted) {
        void sendPlaybackReport('stop', { keepalive: true });
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (hasStarted) {
        void sendPlaybackReport('stop', { keepalive: true });
      }
    };
  }, [hasStarted, sendPlaybackReport]);

  const handleReloadPlayback = useCallback(
    async (overrides: {
      mediaSourceId?: string | null;
      audioStreamIndex?: number | null;
      subtitleStreamIndex?: number | null;
      maxStreamingBitrate?: number | null;
    }) => {
      if (!resolvedItemId) return;

      const video = videoRef.current;
      resumeAfterReloadRef.current = !!video && !video.paused;

      if (hasStarted) {
        await sendPlaybackReport('progress');
      }

      await fetchPlaybackInfo(resolvedItemId, {
        mediaSourceId: overrides.mediaSourceId,
        audioStreamIndex: overrides.audioStreamIndex,
        subtitleStreamIndex: overrides.subtitleStreamIndex,
        maxStreamingBitrate: overrides.maxStreamingBitrate,
        startTimeTicks: getCurrentPositionTicks(),
      });
    },
    [fetchPlaybackInfo, getCurrentPositionTicks, hasStarted, resolvedItemId, sendPlaybackReport],
  );

  const handleAudioChange = async (value: string) => {
    const parsed = Number(value);
    const nextValue = Number.isFinite(parsed) ? parsed : null;
    setSelectedAudioIndex(nextValue);
    await handleReloadPlayback({ audioStreamIndex: nextValue });
  };

  const handleSubtitleChange = async (value: string) => {
    const nextValue = value === 'off' ? null : Number(value);
    setSelectedSubtitleIndex(nextValue);
    await handleReloadPlayback({ subtitleStreamIndex: nextValue });
  };

  const handleQualityChange = async (value: string) => {
    const selected = playback?.qualityOptions.find((option) => option.id === value) || null;
    setSelectedQualityId(value);
    setMaxStreamingBitrate(selected?.estimatedBitrate ?? null);
    await handleReloadPlayback({
      mediaSourceId: value,
      maxStreamingBitrate: selected?.estimatedBitrate ?? null,
    });
  };

  const handlePlayNextNow = async () => {
    if (!nextEpisode) return;
    setCountdown(null);
    router.replace(`/watch?itemId=${encodeURIComponent(nextEpisode.Id)}`);
  };

  const stateBadge = playback
    ? normalizeTitleCase(playback.playMethod)
    : resolving
      ? 'Resolving'
      : 'Idle';

  return (
    <div className="pb-6">
      <PageHeader
        title={playback?.item.Name || 'Jellyfin Player'}
        subtitle={playback?.item.SeriesName}
        rightContent={
          <Badge variant="outline" className="text-xs mr-1">
            {stateBadge}
          </Badge>
        }
      />

      <div className="px-4 space-y-4 pt-3">
        <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
          {(loading || resolving) && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-20">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          )}

          <video
            ref={videoRef}
            controls
            playsInline
            className="w-full h-full"
            preload="metadata"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {playback && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Quality</span>
                <select
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  value={selectedQualityId || ''}
                  onChange={(event) => {
                    void handleQualityChange(event.target.value);
                  }}
                >
                  {playback.qualityOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Audio</span>
                <select
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  value={selectedAudioIndex != null ? String(selectedAudioIndex) : ''}
                  onChange={(event) => {
                    void handleAudioChange(event.target.value);
                  }}
                >
                  {playback.audioTracks.map((track) => (
                    <option key={track.index} value={track.index}>
                      {track.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Subtitles</span>
                <select
                  className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                  value={selectedSubtitleIndex != null ? String(selectedSubtitleIndex) : 'off'}
                  onChange={(event) => {
                    void handleSubtitleChange(event.target.value);
                  }}
                >
                  <option value="off">Off</option>
                  {playback.subtitleTracks.map((track) => (
                    <option key={track.index} value={track.index}>
                      {track.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="rounded-lg border px-3 py-2 text-xs text-muted-foreground space-y-1">
              <div>
                <span className="font-medium text-foreground">Method:</span> {normalizeTitleCase(playback.playMethod)}
              </div>
              <div>
                <span className="font-medium text-foreground">Bitrate:</span> {formatBitrate(maxStreamingBitrate ?? undefined)}
              </div>
              {!!playback.transcodeReasons?.length && (
                <div>
                  <span className="font-medium text-foreground">Transcode reasons:</span>{' '}
                  {playback.transcodeReasons.join(', ')}
                </div>
              )}
            </div>
          </div>
        )}

        {countdown != null && nextEpisode && (
          <div className="rounded-lg border px-3 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Up next: {nextEpisode.Name}</p>
              <p className="text-xs text-muted-foreground">
                Playing in {countdown}s
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setCountdown(null)}>
                <Pause className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button size="sm" onClick={() => void handlePlayNextNow()}>
                <SkipForward className="h-4 w-4 mr-1" />
                Play now
              </Button>
            </div>
          </div>
        )}

        {!nextEpisode && playback?.item.Type === 'Episode' && (
          <div className="text-xs text-muted-foreground">No next episode found in Jellyfin.</div>
        )}

        {playback?.item.Type === 'Movie' && (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Play className="h-3 w-3" />
            You are streaming inside Helprr.
          </div>
        )}
      </div>
    </div>
  );
}

function WatchPageFallback() {
  return (
    <div className="pb-6 px-4 pt-4">
      <div className="w-full aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-white" />
      </div>
    </div>
  );
}

export default function WatchPage() {
  return (
    <Suspense fallback={<WatchPageFallback />}>
      <WatchPageContent />
    </Suspense>
  );
}
