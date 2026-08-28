'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { JellyfinItem, JellyfinMediaStream } from '@/types/jellyfin';
import type { HelprrStreamInfo, JellyfinPlayMethod, MediaSegment } from '@/types/jellyfin-streaming';
import { getDeviceProfile } from '@/lib/jellyfin-playback/device-profile';
import { getJellyfinPlaybackDeviceId, getJellyfinPlaybackDeviceName, secondsToTicks, ticksToSeconds } from '@/lib/jellyfin-playback/device';
import { canPlayHlsWithMse, canPlayNativeHls, detectBrowser } from '@/lib/jellyfin-playback/browser';
import { jellyfinPosterUrl } from '@/lib/jellyfin-playback/image';
import { useUIStore } from '@/lib/store';
import { subtitleCueLine } from '@/lib/jellyfin-playback/subtitle-appearance';

export type RepeatMode = 'RepeatNone' | 'RepeatAll' | 'RepeatOne';

export interface PlayOptions {
  startTimeTicks?: number;
  audioStreamIndex?: number | null;
  subtitleStreamIndex?: number | null;
  maxStreamingBitrate?: number;
  enableDirectPlay?: boolean;
  enableDirectStream?: boolean;
  shuffle?: boolean;
}

interface PlaybackContextValue {
  queue: JellyfinItem[];
  index: number;
  item: JellyfinItem | null;
  stream: HelprrStreamInfo | null;
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  error: string | null;
  /**
   * The member has no usable Jellyfin token, so nothing can be played as them.
   * The video stage swaps in the connect gate instead of an error message —
   * signing in is the fix, not retrying.
   */
  needsJellyfinConnect: boolean;
  /** Re-attempt the pending item once the member has connected. */
  retryAfterConnect: () => void;
  positionSeconds: number;
  durationSeconds: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  maxBitrate: number;
  repeat: RepeatMode;
  shuffled: boolean;
  videoExpanded: boolean;
  queueOpen: boolean;
  segments: MediaSegment[];
  audioStreamIndex: number | null;
  subtitleStreamIndex: number | null;
  subtitleOffsetSeconds: number;
  playItems: (items: JellyfinItem[], startIndex?: number, options?: PlayOptions) => Promise<void>;
  playItem: (item: JellyfinItem, options?: PlayOptions) => Promise<void>;
  addToQueue: (items: JellyfinItem[]) => void;
  playQueueIndex: (nextIndex: number) => Promise<void>;
  togglePause: () => void;
  stop: () => Promise<void>;
  seek: (seconds: number) => void;
  skip: (deltaSeconds: number) => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setAudioStream: (index: number) => Promise<void>;
  setSubtitleStream: (index: number) => Promise<void>;
  setMaxBitrate: (bitrate: number) => Promise<void>;
  setRepeat: (mode: RepeatMode) => void;
  toggleShuffle: () => void;
  setVideoExpanded: (expanded: boolean) => void;
  setQueueOpen: (open: boolean) => void;
  skipSegment: (segment: MediaSegment) => void;
  setSubtitleOffset: (seconds: number) => void;
}

const PlaybackContext = createContext<PlaybackContextValue | null>(null);
const MediaRefContext = createContext<React.RefObject<HTMLVideoElement | null> | null>(null);

/**
 * The server could not act as this member — no Jellyfin token, no identity
 * link, or the token was revoked upstream. Distinct from a playback failure
 * because the fix is signing in, not retrying.
 */
export class JellyfinConnectRequiredError extends Error {
  constructor() {
    super('Connect your Jellyfin account to watch.');
    this.name = 'JellyfinConnectRequiredError';
  }
}

async function fetchStream(itemId: string, options: PlayOptions): Promise<HelprrStreamInfo> {
  const deviceProfile = getDeviceProfile({
    maxStreamingBitrate: options.maxStreamingBitrate && options.maxStreamingBitrate > 0
      ? options.maxStreamingBitrate
      : 120_000_000,
    isRetry: options.enableDirectPlay === false,
  });
  const res = await fetch('/api/jellyfin/stream/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      itemId,
      deviceId: getJellyfinPlaybackDeviceId(),
      deviceName: getJellyfinPlaybackDeviceName(),
      deviceProfile,
      startTimeTicks: options.startTimeTicks,
      audioStreamIndex: options.audioStreamIndex,
      subtitleStreamIndex: options.subtitleStreamIndex,
      maxStreamingBitrate: options.maxStreamingBitrate && options.maxStreamingBitrate > 0
        ? options.maxStreamingBitrate
        : undefined,
      enableDirectPlay: options.enableDirectPlay,
      enableDirectStream: options.enableDirectStream,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Playback failed' }));
    if (res.status === 409 && body.error === 'jellyfin_connect_required') {
      throw new JellyfinConnectRequiredError();
    }
    throw new Error(typeof body.error === 'string' ? body.error : 'Playback failed');
  }
  return res.json() as Promise<HelprrStreamInfo>;
}

function reportBody(event: 'playing' | 'progress' | 'stopped', stream: HelprrStreamInfo, extra: Record<string, unknown>) {
  return JSON.stringify({
    event,
    itemId: stream.item.Id,
    deviceId: getJellyfinPlaybackDeviceId(),
    deviceName: getJellyfinPlaybackDeviceName(),
    mediaSourceId: stream.mediaSource.Id,
    playSessionId: stream.playSessionId,
    playMethod: stream.playMethod,
    liveStreamId: stream.liveStreamId,
    canSeek: true,
    ...extra,
  });
}

/**
 * Best-effort Stopped report while the page is going away. jellyfin-web does
 * the same thing from a `beforeunload` handler (playbackmanager.js
 * `onAppClose`); `fetch` is not guaranteed to survive unload, so this uses
 * sendBeacon with an explicit JSON blob — the default beacon content type is
 * text/plain, which the route's `request.json()` would still parse, but being
 * explicit keeps the API contract honest.
 */
function beaconStopped(stream: HelprrStreamInfo, positionTicks: number) {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
  const body = reportBody('stopped', stream, { positionTicks, isPaused: true });
  navigator.sendBeacon('/api/jellyfin/stream/session', new Blob([body], { type: 'application/json' }));
  if (stream.playSessionId) {
    navigator.sendBeacon(
      '/api/jellyfin/stream/stop-encodings',
      new Blob([JSON.stringify({
        playSessionId: stream.playSessionId,
        deviceId: getJellyfinPlaybackDeviceId(),
        deviceName: getJellyfinPlaybackDeviceName(),
      })], { type: 'application/json' }),
    );
  }
}

async function report(event: 'playing' | 'progress' | 'stopped', stream: HelprrStreamInfo, extra: {
  positionTicks: number;
  isPaused: boolean;
  volumeLevel: number;
  isMuted: boolean;
  playbackRate: number;
  audioStreamIndex?: number | null;
  subtitleStreamIndex?: number | null;
  repeatMode?: RepeatMode;
  shuffleMode?: 'Sorted' | 'Shuffle';
  playbackStartTimeTicks?: number;
  maxStreamingBitrate?: number;
}) {
  await fetch('/api/jellyfin/stream/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      itemId: stream.item.Id,
      deviceId: getJellyfinPlaybackDeviceId(),
      deviceName: getJellyfinPlaybackDeviceName(),
      mediaSourceId: stream.mediaSource.Id,
      playSessionId: stream.playSessionId,
      playMethod: stream.playMethod,
      liveStreamId: stream.liveStreamId,
      canSeek: true,
      repeatMode: extra.repeatMode,
      ...extra,
    }),
  }).catch(() => undefined);
}

async function stopEncodings(playSessionId: string) {
  if (!playSessionId) return;
  await fetch('/api/jellyfin/stream/stop-encodings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playSessionId,
      deviceId: getJellyfinPlaybackDeviceId(),
      deviceName: getJellyfinPlaybackDeviceName(),
    }),
  }).catch(() => undefined);
}

async function fetchCatalogItems(params: Record<string, string>): Promise<JellyfinItem[]> {
  const search = new URLSearchParams(params);
  const res = await fetch(`/api/jellyfin/catalog/items?${search}`);
  if (!res.ok) return [];
  const data = await res.json() as { items?: JellyfinItem[] };
  return data.items ?? [];
}

async function resolvePlayable(item: JellyfinItem): Promise<JellyfinItem[]> {
  if (item.Type === 'MusicAlbum' || item.Type === 'Playlist' || item.Type === 'Folder') {
    const items = await fetchCatalogItems({
      parentId: item.Id,
      includeItemTypes: item.Type === 'MusicAlbum' || item.Type === 'Playlist' ? 'Audio' : 'Audio,Video,Movie,Episode',
      recursive: 'true',
      sortBy: item.Type === 'MusicAlbum' ? 'IndexNumber' : 'SortName',
      limit: '200',
    });
    return items.length ? items : [item];
  }
  if (item.Type === 'MusicArtist') {
    const items = await fetchCatalogItems({
      artistIds: item.Id,
      includeItemTypes: 'Audio',
      recursive: 'true',
      sortBy: 'Album,IndexNumber',
      limit: '200',
    });
    return items.length ? items : [item];
  }
  if (item.Type === 'BoxSet') {
    const items = await fetchCatalogItems({
      parentId: item.Id,
      recursive: 'true',
      includeItemTypes: 'Movie,Episode,Video',
      sortBy: 'SortName',
      limit: '200',
    });
    return items.length ? items : [item];
  }
  if (item.Type === 'Series' || item.Type === 'Season') {
    const parentId = item.Type === 'Season' ? (item.SeriesId || item.Id) : item.Id;
    const nextUp = await fetch(`/api/jellyfin/catalog/next-up?parentId=${encodeURIComponent(parentId)}`);
    if (nextUp.ok) {
      const data = await nextUp.json() as { items?: JellyfinItem[] };
      if (data.items?.[0]) {
        const rest = await remainingEpisodes(data.items[0]);
        return [data.items[0], ...rest];
      }
    }
    const episodes = await fetchCatalogItems({
      parentId: item.Id,
      includeItemTypes: 'Episode',
      recursive: 'true',
      sortBy: 'ParentIndexNumber,IndexNumber',
      limit: '200',
    });
    const unplayed = episodes.find((candidate) => !candidate.UserData?.Played);
    if (unplayed) {
      const start = episodes.findIndex((candidate) => candidate.Id === unplayed.Id);
      return start >= 0 ? episodes.slice(start) : [unplayed];
    }
    if (episodes[0]) return episodes;
  }
  if (item.Type === 'Episode') {
    const rest = await remainingEpisodes(item);
    return [item, ...rest];
  }
  return [item];
}

async function remainingEpisodes(item: JellyfinItem): Promise<JellyfinItem[]> {
  if (!item.SeriesId) return [];
  const episodes = await fetchCatalogItems({
    parentId: item.SeriesId,
    includeItemTypes: 'Episode',
    recursive: 'true',
    sortBy: 'ParentIndexNumber,IndexNumber',
    limit: '200',
  });
  const index = episodes.findIndex((candidate) => candidate.Id === item.Id);
  if (index < 0) return [];
  return episodes.slice(index + 1);
}

function shuffleInPlace<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function clearTextTracks(el: HTMLVideoElement) {
  el.querySelectorAll('track').forEach((track) => track.remove());
}

function fontUrls(stream: HelprrStreamInfo): string[] {
  return (stream.mediaSource.MediaAttachments ?? [])
    .filter((attachment) => {
      const mime = (attachment.MimeType || '').toLowerCase();
      const name = (attachment.FileName || '').toLowerCase();
      return mime.includes('font') || /\.(ttf|otf|woff2?)$/.test(name);
    })
    .map((attachment) => attachment.DeliveryUrl)
    .filter((url): url is string => Boolean(url));
}

export function JellyfinPlaybackProvider({ children }: { children: ReactNode }) {
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const subtitleAppearance = useUIStore((state) => state.subtitleAppearance);
  const cueLineRef = useRef(subtitleCueLine(subtitleAppearance.verticalPosition));
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const assRef = useRef<{ dispose?: () => void } | null>(null);
  const streamRef = useRef<HelprrStreamInfo | null>(null);
  const queueRef = useRef<JellyfinItem[]>([]);
  const indexRef = useRef(0);
  const orderRef = useRef<JellyfinItem[]>([]);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryingRef = useRef(false);
  const playbackStartRef = useRef(0);
  const subtitleOffsetRef = useRef(0);
  const shuffledRef = useRef(false);
  const repeatRef = useRef<RepeatMode>('RepeatNone');

  const [queue, setQueue] = useState<JellyfinItem[]>([]);
  const [index, setIndex] = useState(0);
  const [stream, setStream] = useState<HelprrStreamInfo | null>(null);
  const [status, setStatus] = useState<PlaybackContextValue['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [needsJellyfinConnect, setNeedsJellyfinConnect] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMutedState] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [maxBitrate, setMaxBitrateState] = useState(0);
  const [repeat, setRepeat] = useState<RepeatMode>('RepeatNone');
  const [shuffled, setShuffled] = useState(false);
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [segments, setSegments] = useState<MediaSegment[]>([]);
  const [audioStreamIndex, setAudioStreamIndex] = useState<number | null>(null);
  const [subtitleStreamIndex, setSubtitleStreamIndex] = useState<number | null>(null);
  const [subtitleOffsetSeconds, setSubtitleOffsetSeconds] = useState(0);

  const item = queue[index] ?? null;

  const clearTimers = () => {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  };

  const destroyPlayers = () => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    try { assRef.current?.dispose?.(); } catch { /* already torn down */ }
    assRef.current = null;
    if (mediaRef.current) clearTextTracks(mediaRef.current);
  };

  /**
   * Fail playback, checking first whether the member is simply no longer
   * connected.
   *
   * A media element error exposes no HTTP status, so a token revoked mid-stream
   * looks exactly like an unplayable file. The media proxy drops the stored
   * token when Jellyfin rejects it, so a disconnected answer here means
   * revocation and the member should get the gate, not a dead end. Only runs on
   * an actual failure, so the extra request costs nothing in the normal case.
   */
  const failPlayback = useCallback(async (fallbackMessage: string) => {
    setStatus('error');
    const connected = await fetch('/api/account/jellyfin/link')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => (typeof body?.connected === 'boolean' ? body.connected : null))
      .catch(() => null);

    if (connected === false) {
      setNeedsJellyfinConnect(true);
      setVideoExpanded(true);
      setError('Connect your Jellyfin account to watch.');
      return;
    }
    setError(fallbackMessage);
  }, []);

  const attachMedia = useCallback(async (next: HelprrStreamInfo, requestedSubtitleIndex?: number | null) => {
    const el = mediaRef.current;
    if (!el) throw new Error('Player is not ready');
    destroyPlayers();
    const start = ticksToSeconds(next.startTimeTicks);
    const browser = detectBrowser();
    const isHls = next.mimeType.toLowerCase().includes('mpegurl') || next.mediaUrl.includes('.m3u8');
    const useNative = isHls && (canPlayNativeHls(el, browser) && (browser.iOS || (browser.safari && !canPlayHlsWithMse())));

    el.playsInline = true;
    el.setAttribute('webkit-playsinline', 'true');
    el.setAttribute('x-webkit-airplay', 'allow');
    el.crossOrigin = 'use-credentials';
    el.playbackRate = playbackRate;
    el.volume = volume;
    el.muted = muted;

    if (isHls && !useNative && canPlayHlsWithMse()) {
      const Hls = (await import('hls.js')).default;
      if (Hls.isSupported()) {
        const maxBufferLength = maxBitrate >= 25_000_000 ? 6 : 30;
        const hls = new Hls({
          startPosition: start || -1,
          manifestLoadingTimeOut: 20_000,
          maxBufferLength,
          maxMaxBufferLength: maxBufferLength,
          xhrSetup(xhr) {
            xhr.withCredentials = true;
          },
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          // Checked before the fatal guard and before the retry below: a 409 is
          // Helprr refusing to serve without a Jellyfin token, not a transient
          // network fault. hls.js retries NETWORK_ERROR indefinitely, so left to
          // the retry path a revoked token stalls the stream silently and no
          // error ever reaches the media element.
          if (data.response?.code === 409) {
            hls.stopLoad();
            void failPlayback('This title could not be played.');
            return;
          }
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
          el.dispatchEvent(new Event('error'));
        });
        hls.loadSource(next.mediaUrl);
        hls.attachMedia(el);
        hlsRef.current = hls;
      } else {
        el.src = next.mediaUrl;
      }
    } else {
      el.src = next.mediaUrl;
      if (start > 0) {
        const applyStart = () => {
          if (Number.isFinite(el.duration) && start < el.duration) el.currentTime = start;
        };
        el.addEventListener('loadedmetadata', applyStart, { once: true });
        if (!isHls) el.currentTime = start;
      }
    }

    const requestedSub = requestedSubtitleIndex ?? next.mediaSource.DefaultSubtitleStreamIndex;
    const selectedSub = requestedSub != null && requestedSub >= 0
      ? next.subtitleTracks.find((track) => track.index === requestedSub && track.deliveryMethod !== 'Encode')
        ?? next.subtitleTracks.find((track) => track.index === requestedSub)
      : undefined;
    if (selectedSub && (selectedSub.format === 'ass' || selectedSub.format === 'ssa') && selectedSub.url) {
      const { default: SubtitlesOctopus } = await import('@jellyfin/libass-wasm');
      assRef.current = new SubtitlesOctopus({
        video: el,
        subUrl: selectedSub.url,
        workerUrl: '/libass/subtitles-octopus-worker.js',
        legacyWorkerUrl: '/libass/subtitles-octopus-worker-legacy.js',
        fallbackFont: '/libass/default.woff2',
        fonts: fontUrls(next),
        renderMode: 'wasm-blend',
        timeOffset: ticksToSeconds(next.transcodingOffsetTicks) + subtitleOffsetRef.current,
      });
    } else if (selectedSub?.url && selectedSub.format !== 'ass' && selectedSub.format !== 'ssa') {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = selectedSub.displayTitle;
      track.srclang = selectedSub.language;
      track.src = selectedSub.url;
      track.default = true;
      el.appendChild(track);
      const enable = () => {
        const textTrack = el.textTracks[0];
        if (!textTrack) return;
        textTrack.mode = 'showing';
        // jellyfin-web sets `cue.line` from the same vertical-position setting
        // (htmlVideoPlayer/plugin.js ~line 1485). ::cue cannot express it.
        const line = cueLineRef.current;
        for (const cue of Array.from(textTrack.cues ?? [])) {
          (cue as VTTCue).line = line;
        }
      };
      track.addEventListener('load', enable);
      enable();
    }

    await el.play();
  }, [failPlayback, maxBitrate, muted, playbackRate, volume]);

  const startItem = useCallback(async (nextItem: JellyfinItem, options: PlayOptions = {}) => {
    setStatus('loading');
    setError(null);
    setNeedsJellyfinConnect(false);
    playbackStartRef.current = Date.now() * 10_000;
    const resumeTicks = options.startTimeTicks
      ?? nextItem.UserData?.PlaybackPositionTicks
      ?? 0;
    const request: PlayOptions = {
      startTimeTicks: resumeTicks,
      audioStreamIndex: options.audioStreamIndex,
      subtitleStreamIndex: options.subtitleStreamIndex,
      maxStreamingBitrate: options.maxStreamingBitrate && options.maxStreamingBitrate > 0
        ? options.maxStreamingBitrate
        : undefined,
      enableDirectPlay: options.enableDirectPlay,
      enableDirectStream: options.enableDirectStream,
    };
    try {
      const nextStream = await fetchStream(nextItem.Id, request);
      streamRef.current = nextStream;
      setStream(nextStream);
      setAudioStreamIndex(nextStream.mediaSource.DefaultAudioStreamIndex ?? request.audioStreamIndex ?? null);
      setSubtitleStreamIndex(request.subtitleStreamIndex ?? nextStream.mediaSource.DefaultSubtitleStreamIndex ?? null);
      setDurationSeconds(ticksToSeconds(nextStream.mediaSource.RunTimeTicks || nextItem.RunTimeTicks));
      setVideoExpanded(nextItem.MediaType !== 'Audio');
      await attachMedia(nextStream, request.subtitleStreamIndex);
      await report('playing', nextStream, {
        positionTicks: secondsToTicks(mediaRef.current?.currentTime || 0) || resumeTicks,
        isPaused: false,
        volumeLevel: Math.round(volume * 100),
        isMuted: muted,
        playbackRate,
        audioStreamIndex: nextStream.mediaSource.DefaultAudioStreamIndex ?? null,
        subtitleStreamIndex: nextStream.mediaSource.DefaultSubtitleStreamIndex ?? null,
        repeatMode: repeatRef.current,
        shuffleMode: shuffledRef.current ? 'Shuffle' : 'Sorted',
        playbackStartTimeTicks: playbackStartRef.current,
        maxStreamingBitrate: maxBitrate || undefined,
      });
      setStatus('playing');
      fetch(`/api/jellyfin/catalog/items/${nextItem.Id}?expand=segments`)
        .then((res) => res.ok ? res.json() : null)
        .then((data: { segments?: MediaSegment[] } | null) => setSegments(data?.segments ?? []))
        .catch(() => setSegments([]));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Playback failed';
      if (cause instanceof JellyfinConnectRequiredError) {
        setStatus('error');
        setNeedsJellyfinConnect(true);
        setError(message);
        // The stage only expands on the success path, so a gated attempt would
        // otherwise leave the form crammed into the mini player. Expand for
        // audio too — a blocking gate the member cannot reach is a dead end,
        // and the retry resets this to whatever the media type wants.
        setVideoExpanded(true);
        return;
      }
      const canRetryDirect = options.enableDirectPlay !== false && !retryingRef.current;
      if (canRetryDirect) {
        retryingRef.current = true;
        // Release whatever the failed attempt opened, or Jellyfin is left with
        // an orphaned transcode for the lifetime of its idle timeout.
        await stopEncodings(streamRef.current?.playSessionId ?? '');
        try {
          await startItem(nextItem, {
            ...request,
            enableDirectPlay: false,
            enableDirectStream: false,
          });
          return;
        } finally {
          retryingRef.current = false;
        }
      }
      setStatus('error');
      setError(message);
    }
  }, [attachMedia, maxBitrate, muted, playbackRate, volume]);

  const playItems = useCallback(async (items: JellyfinItem[], startIndex = 0, options?: PlayOptions) => {
    const resolved = (await Promise.all(items.map(resolvePlayable))).flat();
    orderRef.current = resolved;
    const shouldShuffle = options?.shuffle ?? shuffled;
    if (options?.shuffle) {
      shuffledRef.current = true;
      setShuffled(true);
    }
    const nextQueue = shouldShuffle ? shuffleInPlace(resolved) : resolved;
    queueRef.current = nextQueue;
    indexRef.current = Math.min(startIndex, Math.max(0, nextQueue.length - 1));
    setQueue(nextQueue);
    setIndex(indexRef.current);
    const nextItem = nextQueue[indexRef.current];
    if (!nextItem) return;
    await startItem(nextItem, options);
  }, [shuffled, startItem]);

  const playItem = useCallback(async (next: JellyfinItem, options?: PlayOptions) => {
    await playItems([next], 0, options);
  }, [playItems]);

  const addToQueue = useCallback((items: JellyfinItem[]) => {
    if (items.length === 0) return;
    const next = [...queueRef.current, ...items];
    queueRef.current = next;
    setQueue(next);
  }, []);

  const playQueueIndex = useCallback(async (nextIndex: number) => {
    const nextItem = queueRef.current[nextIndex];
    if (!nextItem) return;
    indexRef.current = nextIndex;
    setIndex(nextIndex);
    await startItem(nextItem, { startTimeTicks: 0 });
  }, [startItem]);

  const stop = useCallback(async () => {
    clearTimers();
    const current = streamRef.current;
    const el = mediaRef.current;
    const positionTicks = secondsToTicks(el?.currentTime ?? positionSeconds);
    if (current) {
      await report('stopped', current, {
        positionTicks,
        isPaused: true,
        volumeLevel: Math.round(volume * 100),
        isMuted: muted,
        playbackRate,
        audioStreamIndex,
        subtitleStreamIndex,
        repeatMode: repeatRef.current,
        shuffleMode: shuffledRef.current ? 'Shuffle' : 'Sorted',
        playbackStartTimeTicks: playbackStartRef.current,
        maxStreamingBitrate: maxBitrate || undefined,
      });
      await stopEncodings(current.playSessionId);
    }
    destroyPlayers();
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    streamRef.current = null;
    setStream(null);
    setStatus('idle');
    setVideoExpanded(false);
    setQueueOpen(false);
    setSegments([]);
    setError(null);
    setNeedsJellyfinConnect(false);
    // Clear the queue too. `item` is derived from it, and anything keyed off a
    // non-null `item` (player chrome, the now-playing bar, key handling) would
    // otherwise stay armed indefinitely after the user stopped playback.
    queueRef.current = [];
    orderRef.current = [];
    indexRef.current = 0;
    setQueue([]);
    setIndex(0);
    setPositionSeconds(0);
    setDurationSeconds(0);
  }, [audioStreamIndex, maxBitrate, muted, playbackRate, positionSeconds, subtitleStreamIndex, volume]);

  const togglePause = useCallback(() => {
    const el = mediaRef.current;
    if (!el || !streamRef.current) return;
    if (el.paused) {
      void el.play();
      setStatus('playing');
    } else {
      el.pause();
      setStatus('paused');
    }
  }, []);

  const seek = useCallback((seconds: number) => {
    const el = mediaRef.current;
    const current = streamRef.current;
    if (!el || !current) return;
    const isHls = current.mimeType.toLowerCase().includes('mpegurl') || current.mediaUrl.includes('.m3u8');
    if (current.playMethod === 'Transcode' && !isHls) {
      void (async () => {
        await stopEncodings(current.playSessionId);
        const nextItem = queueRef.current[indexRef.current];
        if (!nextItem) return;
        await startItem(nextItem, {
          startTimeTicks: secondsToTicks(seconds),
          audioStreamIndex,
          subtitleStreamIndex,
          maxStreamingBitrate: maxBitrate,
        });
      })();
      return;
    }
    el.currentTime = seconds;
    setPositionSeconds(seconds);
  }, [audioStreamIndex, maxBitrate, startItem, subtitleStreamIndex]);

  const skip = useCallback((deltaSeconds: number) => {
    seek(Math.max(0, positionSeconds + deltaSeconds));
  }, [positionSeconds, seek]);

  const next = useCallback(async () => {
    const list = queueRef.current;
    const currentIndex = indexRef.current;
    if (repeat === 'RepeatOne') {
      const current = list[currentIndex];
      if (current) await startItem(current, { startTimeTicks: 0 });
      return;
    }
    if (currentIndex + 1 < list.length) {
      indexRef.current = currentIndex + 1;
      setIndex(currentIndex + 1);
      await startItem(list[currentIndex + 1], { startTimeTicks: 0 });
      return;
    }
    if (repeat === 'RepeatAll' && list[0]) {
      indexRef.current = 0;
      setIndex(0);
      await startItem(list[0], { startTimeTicks: 0 });
      return;
    }
    await stop();
  }, [repeat, startItem, stop]);

  const previous = useCallback(async () => {
    if (positionSeconds > 5) {
      seek(0);
      return;
    }
    const currentIndex = indexRef.current;
    if (currentIndex <= 0) {
      seek(0);
      return;
    }
    indexRef.current = currentIndex - 1;
    setIndex(currentIndex - 1);
    await startItem(queueRef.current[currentIndex - 1], { startTimeTicks: 0 });
  }, [positionSeconds, seek, startItem]);

  const restartWith = useCallback(async (patch: PlayOptions) => {
    const current = streamRef.current;
    const nextItem = queueRef.current[indexRef.current];
    if (!current || !nextItem) return;
    await stopEncodings(current.playSessionId);
    await startItem(nextItem, {
      startTimeTicks: secondsToTicks(mediaRef.current?.currentTime ?? positionSeconds),
      audioStreamIndex: patch.audioStreamIndex ?? audioStreamIndex,
      subtitleStreamIndex: patch.subtitleStreamIndex ?? subtitleStreamIndex,
      maxStreamingBitrate: patch.maxStreamingBitrate ?? maxBitrate,
      enableDirectPlay: patch.enableDirectPlay,
      enableDirectStream: patch.enableDirectStream,
    });
  }, [audioStreamIndex, maxBitrate, positionSeconds, startItem, subtitleStreamIndex]);

  const setAudioStream = useCallback(async (streamIndex: number) => {
    setAudioStreamIndex(streamIndex);
    await restartWith({ audioStreamIndex: streamIndex });
  }, [restartWith]);

  const setSubtitleStream = useCallback(async (streamIndex: number) => {
    setSubtitleStreamIndex(streamIndex);
    await restartWith({ subtitleStreamIndex: streamIndex });
  }, [restartWith]);

  const setMaxBitrate = useCallback(async (bitrate: number) => {
    setMaxBitrateState(bitrate);
    await restartWith({ maxStreamingBitrate: bitrate });
  }, [restartWith]);

  const skipSegment = useCallback((segment: MediaSegment) => {
    if (segment.EndTicks) seek(ticksToSeconds(segment.EndTicks));
  }, [seek]);

  const setSubtitleOffset = useCallback((seconds: number) => {
    const next = Math.min(10, Math.max(-10, Number.isFinite(seconds) ? seconds : 0));
    subtitleOffsetRef.current = next;
    setSubtitleOffsetSeconds(next);
    const octopus = assRef.current as { timeOffset?: number } | null;
    if (octopus) octopus.timeOffset = ticksToSeconds(streamRef.current?.transcodingOffsetTicks) + next;
  }, []);

  const setRepeatMode = useCallback((mode: RepeatMode) => {
    repeatRef.current = mode;
    setRepeat(mode);
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffled((current) => {
      const nextShuffled = !current;
      shuffledRef.current = nextShuffled;
      const currentItem = queueRef.current[indexRef.current];
      if (!currentItem) return nextShuffled;
      const base = orderRef.current.length ? orderRef.current : queueRef.current;
      let nextQueue: JellyfinItem[];
      if (nextShuffled) {
        const rest = shuffleInPlace(base.filter((candidate) => candidate.Id !== currentItem.Id));
        nextQueue = [currentItem, ...rest];
      } else {
        nextQueue = base;
        const restored = Math.max(0, nextQueue.findIndex((candidate) => candidate.Id === currentItem.Id));
        indexRef.current = restored;
        setIndex(restored);
      }
      queueRef.current = nextQueue;
      if (nextShuffled) {
        indexRef.current = 0;
        setIndex(0);
      }
      setQueue(nextQueue);
      return nextShuffled;
    });
  }, []);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return undefined;
    const onTime = () => {
      setPositionSeconds(el.currentTime);
      if (el.duration && Number.isFinite(el.duration)) setDurationSeconds(el.duration);
    };
    const onPlay = () => setStatus('playing');
    const onPause = () => {
      if (streamRef.current) setStatus('paused');
    };
    const onEnded = () => { void next(); };
    const onVolume = () => {
      setVolumeState(el.volume);
      setMutedState(el.muted);
    };
    const onError = () => {
      const current = streamRef.current;
      const nextItem = queueRef.current[indexRef.current];
      if (!current || !nextItem || retryingRef.current) {
        // failPlayback, not a bare error: a token revoked mid-stream reaches the
        // element as an indistinguishable media error.
        if (current) void failPlayback('This title could not be played.');
        return;
      }
      if (current.playMethod === 'DirectPlay' || current.playMethod === 'DirectStream') {
        retryingRef.current = true;
        void stopEncodings(current.playSessionId);
        void startItem(nextItem, {
          startTimeTicks: secondsToTicks(el.currentTime || 0),
          audioStreamIndex,
          subtitleStreamIndex,
          maxStreamingBitrate: maxBitrate,
          enableDirectPlay: false,
          enableDirectStream: false,
        }).finally(() => { retryingRef.current = false; });
      } else {
        // Already transcoding, so there is no lower fallback to drop to. This is
        // the path a revocation during an active transcode lands on.
        void failPlayback('This title could not be played.');
      }
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('volumechange', onVolume);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('volumechange', onVolume);
      el.removeEventListener('error', onError);
    };
  }, [audioStreamIndex, failPlayback, maxBitrate, next, startItem, subtitleStreamIndex]);

  useEffect(() => {
    clearTimers();
    if (status !== 'playing' && status !== 'paused') return undefined;
    progressTimer.current = setInterval(() => {
      const current = streamRef.current;
      const el = mediaRef.current;
      if (!current || !el) return;
      void report('progress', current, {
        positionTicks: secondsToTicks(el.currentTime),
        isPaused: el.paused,
        volumeLevel: Math.round(el.volume * 100),
        isMuted: el.muted,
        playbackRate: el.playbackRate,
        audioStreamIndex,
        subtitleStreamIndex,
        repeatMode: repeatRef.current,
        shuffleMode: shuffledRef.current ? 'Shuffle' : 'Sorted',
        playbackStartTimeTicks: playbackStartRef.current,
        maxStreamingBitrate: maxBitrate || undefined,
      });
    }, 10_000);
    return clearTimers;
  }, [audioStreamIndex, maxBitrate, status, subtitleStreamIndex]);

  useEffect(() => {
    cueLineRef.current = subtitleCueLine(subtitleAppearance.verticalPosition);
    const textTrack = mediaRef.current?.textTracks?.[0];
    if (!textTrack) return;
    for (const cue of Array.from(textTrack.cues ?? [])) {
      (cue as VTTCue).line = cueLineRef.current;
    }
  }, [subtitleAppearance.verticalPosition]);

  // Report Stopped when the page goes away. Without this the Jellyfin session
  // lingers in Active Devices and a transcode keeps running until Jellyfin's own
  // idle timeout. `persisted` means the page went into the bfcache and may come
  // back, so leave playback alone there. Deliberately not hooked to
  // `visibilitychange`: backgrounding the PWA on iOS must not kill audio.
  useEffect(() => {
    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      const current = streamRef.current;
      if (!current) return;
      beaconStopped(current, secondsToTicks(mediaRef.current?.currentTime ?? 0));
      streamRef.current = null;
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  useEffect(() => {
    const current = streamRef.current?.item;
    if (!current || typeof navigator === 'undefined' || !navigator.mediaSession) return;
    const artwork = jellyfinPosterUrl(current, 512);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.Name,
      artist: current.SeriesName || current.AlbumArtist || current.Artists?.join(', ') || 'Jellyfin',
      album: current.SeasonName || current.Album || '',
      artwork: artwork ? [{ src: artwork, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => { void mediaRef.current?.play(); });
    navigator.mediaSession.setActionHandler('pause', () => { mediaRef.current?.pause(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => { void previous(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { void next(); });
    navigator.mediaSession.setActionHandler('seekbackward', () => skip(-10));
    navigator.mediaSession.setActionHandler('seekforward', () => skip(10));
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') seek(details.seekTime);
    });
  }, [next, previous, seek, skip, stream]);

  const setVolume = useCallback((value: number) => {
    const el = mediaRef.current;
    const nextVolume = Math.min(1, Math.max(0, value));
    if (el) el.volume = nextVolume;
    setVolumeState(nextVolume);
  }, []);

  const setMuted = useCallback((value: boolean) => {
    const el = mediaRef.current;
    if (el) el.muted = value;
    setMutedState(value);
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const el = mediaRef.current;
    if (el) el.playbackRate = rate;
    setPlaybackRateState(rate);
  }, []);

  /**
   * Replay whatever the gate interrupted. The queue is untouched by a gated
   * attempt, so the pending item is still at the current index — no need to
   * stash it separately.
   */
  const retryAfterConnect = useCallback(() => {
    const pending = queueRef.current[indexRef.current];
    if (!pending) {
      setNeedsJellyfinConnect(false);
      return;
    }
    // No startTimeTicks: the gated attempt never played, so startItem should
    // fall back to the item's own resume point like a fresh play would.
    void startItem(pending, {
      audioStreamIndex,
      subtitleStreamIndex,
      maxStreamingBitrate: maxBitrate,
    });
  }, [audioStreamIndex, maxBitrate, startItem, subtitleStreamIndex]);

  const value = useMemo<PlaybackContextValue>(() => ({
    queue,
    index,
    item,
    stream,
    status,
    error,
    needsJellyfinConnect,
    retryAfterConnect,
    positionSeconds,
    durationSeconds,
    volume,
    muted,
    playbackRate,
    maxBitrate,
    repeat,
    shuffled,
    videoExpanded,
    queueOpen,
    segments,
    audioStreamIndex,
    subtitleStreamIndex,
    subtitleOffsetSeconds,
    playItems,
    playItem,
    addToQueue,
    playQueueIndex,
    togglePause,
    stop,
    seek,
    skip,
    next,
    previous,
    setVolume,
    setMuted,
    setPlaybackRate,
    setAudioStream,
    setSubtitleStream,
    setMaxBitrate,
    setRepeat: setRepeatMode,
    toggleShuffle,
    setVideoExpanded,
    setQueueOpen,
    skipSegment,
    setSubtitleOffset,
  }), [
    addToQueue, audioStreamIndex, durationSeconds, error, index, item, maxBitrate, muted,
    needsJellyfinConnect, next, playItem, retryAfterConnect,
    playItems, playQueueIndex, playbackRate, positionSeconds, previous, queue, queueOpen, repeat, seek,
    segments, setAudioStream, setMaxBitrate, setMuted, setPlaybackRate, setRepeatMode, setSubtitleOffset,
    setSubtitleStream, setVolume, shuffled, skip, skipSegment, status, stop, stream, subtitleOffsetSeconds,
    subtitleStreamIndex, togglePause, toggleShuffle, videoExpanded, volume,
  ]);

  return (
    <PlaybackContext.Provider value={value}>
      <MediaRefContext.Provider value={mediaRef}>
        {children}
      </MediaRefContext.Provider>
    </PlaybackContext.Provider>
  );
}

export function useJellyfinPlayback(): PlaybackContextValue {
  const value = useContext(PlaybackContext);
  if (!value) throw new Error('useJellyfinPlayback must be used within JellyfinPlaybackProvider');
  return value;
}

export function useJellyfinMediaRef(): React.RefObject<HTMLVideoElement | null> {
  const mediaRef = useContext(MediaRefContext);
  if (!mediaRef) throw new Error('useJellyfinMediaRef must be used within JellyfinPlaybackProvider');
  return mediaRef;
}

export function audioStreams(stream: HelprrStreamInfo | null): JellyfinMediaStream[] {
  return (stream?.mediaSource.MediaStreams ?? []).filter((candidate) => candidate.Type === 'Audio');
}

export function subtitleStreams(stream: HelprrStreamInfo | null): JellyfinMediaStream[] {
  return (stream?.mediaSource.MediaStreams ?? []).filter((candidate) => candidate.Type === 'Subtitle');
}

export function playMethodLabel(method: JellyfinPlayMethod | undefined): string {
  if (method === 'DirectPlay') return 'Direct play';
  if (method === 'DirectStream') return 'Direct stream';
  if (method === 'Transcode') return 'Transcode';
  return '';
}
