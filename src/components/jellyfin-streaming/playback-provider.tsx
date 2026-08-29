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
  /**
   * Which media source the indexes above refer to.
   *
   * Jellyfin ignores AudioStreamIndex and SubtitleStreamIndex unless
   * MediaSourceId comes with them — measured against 10.11.11: requesting
   * audio track 5 on its own still returns a transcode URL for track 1, and
   * the same request with the source id returns track 5. jellyfin-web always
   * sends it (playbackmanager.js `changeStream` passes `currentMediaSource.Id`
   * into `getPlaybackInfo`). Without it, picking another audio track or a
   * burned-in subtitle silently does nothing.
   */
  mediaSourceId?: string;
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
      mediaSourceId: options.mediaSourceId,
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

/**
 * A resolved play request: what goes in the queue, and which entry of it the
 * caller actually asked for.
 *
 * The start index has to travel with the items. Playing episode 5 of a
 * thirteen-episode show queues all thirteen, and the one thing the queue must
 * agree with the player about is which of them is on screen.
 */
interface Playable {
  items: JellyfinItem[];
  startIndex: number;
}

/**
 * How many episodes a series queue holds.
 *
 * Every episode of the show, in broadcast order, because that is what the
 * queue panel lists and what "next episode" has to be able to cross a season
 * boundary for. Bounded so a thousand-episode show cannot turn one Play into a
 * multi-megabyte payload; libraries past this are served the first 500, and
 * playback still advances normally within them.
 */
const SERIES_QUEUE_LIMIT = 500;

/** Every episode of a series, in season-then-episode order. */
async function seriesEpisodes(seriesId: string): Promise<JellyfinItem[]> {
  return fetchCatalogItems({
    parentId: seriesId,
    includeItemTypes: 'Episode',
    recursive: 'true',
    sortBy: 'ParentIndexNumber,IndexNumber',
    limit: String(SERIES_QUEUE_LIMIT),
  });
}

/**
 * The member's own Next Up for a series, if Jellyfin has one.
 *
 * Keyed by series even when a season was asked for: `/Shows/NextUp` has no
 * season filter, and the caller scopes the answer to the season it wants.
 */
async function nextUpEpisode(seriesId: string): Promise<JellyfinItem | null> {
  const res = await fetch(`/api/jellyfin/catalog/next-up?seriesId=${encodeURIComponent(seriesId)}`)
    .catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null) as { items?: JellyfinItem[] } | null;
  return data?.items?.[0] ?? null;
}

/**
 * Flatten resolved play requests into one queue, and translate the caller's
 * index into an index into it.
 *
 * `startIndex` is an index into what the caller passed, and each of those can
 * expand into many queue entries — a series into its episodes, an album into
 * its tracks. Used directly, playing episode 5 of a thirteen-episode show
 * landed on episode 1: the request had become a thirteen-item queue while the
 * caller was still saying "index 0".
 */
export function flattenPlayables(
  resolved: Playable[],
  startIndex: number,
): { items: JellyfinItem[]; index: number } {
  const wanted = Math.min(Math.max(0, startIndex), Math.max(0, resolved.length - 1));
  const items: JellyfinItem[] = [];
  let index = 0;
  resolved.forEach((entry, entryIndex) => {
    if (entryIndex === wanted) index = items.length + entry.startIndex;
    items.push(...entry.items);
  });
  return { items, index: Math.min(index, Math.max(0, items.length - 1)) };
}

async function resolvePlayable(item: JellyfinItem): Promise<Playable> {
  if (item.Type === 'MusicAlbum' || item.Type === 'Playlist' || item.Type === 'Folder') {
    const items = await fetchCatalogItems({
      parentId: item.Id,
      includeItemTypes: item.Type === 'MusicAlbum' || item.Type === 'Playlist' ? 'Audio' : 'Audio,Video,Movie,Episode',
      recursive: 'true',
      sortBy: item.Type === 'MusicAlbum' ? 'IndexNumber' : 'SortName',
      limit: '200',
    });
    return { items: items.length ? items : [item], startIndex: 0 };
  }
  if (item.Type === 'MusicArtist') {
    const items = await fetchCatalogItems({
      artistIds: item.Id,
      includeItemTypes: 'Audio',
      recursive: 'true',
      sortBy: 'Album,IndexNumber',
      limit: '200',
    });
    return { items: items.length ? items : [item], startIndex: 0 };
  }
  if (item.Type === 'BoxSet') {
    const items = await fetchCatalogItems({
      parentId: item.Id,
      recursive: 'true',
      includeItemTypes: 'Movie,Episode,Video',
      sortBy: 'SortName',
      limit: '200',
    });
    return { items: items.length ? items : [item], startIndex: 0 };
  }

  /**
   * Series, season and episode all queue the *whole show*, and only differ in
   * where they start.
   *
   * jellyfin-web queues from the played episode onward and nothing before it
   * (playbackManager `translateItemsForPlayback` filters the episode list with
   * a `foundItem` flag), which is fine for its purpose — it has no episode
   * panel in the player, only auto-advance. Ours does, and inheriting that
   * shape is exactly what made it wrong: starting episode 5 of thirteen gave a
   * nine-item list whose first entry was the episode playing, so the panel
   * reported "Queue · 9" and highlighted row 1. There is no way to show a
   * series' episodes from a queue that begins at the current one, so the queue
   * carries the series and the index carries the position — which is also what
   * lets "next" cross into the following season.
   */
  if (item.Type === 'Series' || item.Type === 'Season') {
    const seriesId = (item.Type === 'Season' ? item.SeriesId : item.Id) || item.Id;
    const episodes = await seriesEpisodes(seriesId);
    if (episodes.length === 0) return { items: [item], startIndex: 0 };
    // Asking for a season means starting inside that season, even though the
    // queue runs the length of the series.
    const scope = item.Type === 'Season'
      ? episodes.filter((candidate) => candidate.SeasonId === item.Id
        || (item.IndexNumber != null && candidate.ParentIndexNumber === item.IndexNumber))
      : episodes;
    const pool = scope.length > 0 ? scope : episodes;
    const upNext = await nextUpEpisode(seriesId);
    const pick = (upNext && pool.find((candidate) => candidate.Id === upNext.Id))
      ?? pool.find((candidate) => !candidate.UserData?.Played)
      ?? pool[0];
    const at = pick ? episodes.findIndex((candidate) => candidate.Id === pick.Id) : 0;
    return { items: episodes, startIndex: Math.max(0, at) };
  }

  if (item.Type === 'Episode' && item.SeriesId) {
    const episodes = await seriesEpisodes(item.SeriesId);
    const at = episodes.findIndex((candidate) => candidate.Id === item.Id);
    // A missing episode means the list was truncated by the limit above, or
    // Jellyfin does not file it under this series; play it on its own rather
    // than dropping the viewer somewhere else in the show.
    if (at >= 0) return { items: episodes, startIndex: at };
  }

  return { items: [item], startIndex: 0 };
}

function shuffleInPlace<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

/**
 * Start playback without treating an interrupted start as a failure.
 *
 * `el.play()` rejects with AbortError whenever a new load request lands on the
 * element before the previous play settles — which is *routine* here: hls.js
 * assigns its own MediaSource URL from `attachMedia`, and switching queue
 * entries replaces the source outright. The rejection was propagating out of
 * attachMedia into startItem's catch, so picking another episode from the
 * queue put "The play() request was interrupted by a new load request" on
 * screen even though the new episode was loading correctly. NotAllowedError is
 * the autoplay policy declining, which is also not a broken file — the viewer
 * can still press play.
 *
 * This is exactly jellyfin-web's htmlMediaHelper.playWithPromise.
 */
async function playSafely(el: HTMLMediaElement): Promise<void> {
  try {
    await el.play();
  } catch (cause) {
    const name = (cause instanceof Error ? cause.name : '').toLowerCase();
    if (name === 'aborterror' || name === 'notallowederror') return;
    throw cause;
  }
}

function clearTextTracks(el: HTMLVideoElement) {
  el.querySelectorAll('track').forEach((track) => track.remove());
}

/**
 * Where one cue sits, given the viewer's vertical-position setting.
 *
 * A negative position counts lines up from the bottom, so a two-line cue has to
 * start a line higher to leave its last line where a one-line cue sits. That is
 * jellyfin-web's rule verbatim (htmlVideoPlayer/plugin.js `renderTracksEvents`).
 */
export function cueLineFor(line: number, text: string): number {
  const lineCount = (text.match(/\n/g) ?? []).length;
  return line < 0 ? line - lineCount : line;
}

/**
 * Position a track's cues from that setting.
 *
 * One writer, deliberately: jellyfin-web sets `cue.line` here and nowhere else,
 * and a second writer in the player chrome is what used to silently override
 * the viewer's choice.
 */
function applyCueLine(track: TextTrack, line: number) {
  for (const cue of Array.from(track.cues ?? []) as VTTCue[]) {
    // Both, and in this order. Jellyfin writes its cues as `line:90%`, which
    // parses to snapToLines false — and with that flag false `line` is a
    // percentage, so a negative position would place the cue above the top of
    // the frame instead of a few lines up from the bottom. jellyfin-web never
    // meets this because it builds its cues itself, where snapToLines defaults
    // to true.
    cue.snapToLines = true;
    cue.line = cueLineFor(line, cue.text);
  }
}

/**
 * Whether this subtitle track can only be shown by re-requesting the stream.
 *
 * Anything Jellyfin has to encode into the picture (PGS, VOBSUB) needs a new
 * transcode, and so does an embedded track while one is already running.
 * Everything else is a text track the element can be handed directly, which is
 * the distinction jellyfin-web draws in `setSubtitleStreamIndex`.
 */
export function subtitleNeedsOwnStream(stream: HelprrStreamInfo, index: number | null): boolean {
  if (index == null || index < 0) return false;
  const track = stream.subtitleTracks.find((candidate) => candidate.index === index);
  if (!track) return false;
  return track.deliveryMethod === 'Encode'
    || (track.deliveryMethod === 'Embed' && stream.playMethod === 'Transcode');
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

/**
 * The position to report, which is not always the one the element shows.
 *
 * Until a freshly attached stream has reached the offset it was started at,
 * the element reads zero, and reporting that would move the member's resume
 * point back to the beginning.
 */
export function positionToReport(el: HTMLMediaElement | null, stream: HelprrStreamInfo, reachedStart: boolean): number {
  if (reachedStart) return secondsToTicks(el?.currentTime ?? 0);
  return stream.startTimeTicks || secondsToTicks(el?.currentTime ?? 0);
}

/**
 * Claim the next start attempt, before anything is awaited.
 *
 * A restart is stop-then-start and the stop is a network round trip, so two
 * quick changes both enter it holding the same live session and reach the start
 * in whichever order the server answers their stops. Arriving last was what
 * won, which is how a third click on PGS could settle on the ASS track chosen
 * second. Claiming here, synchronously, leaves the newest request the only one
 * that gets through: jellyfin-web has this for free because it mutates one
 * `playerData` before it awaits anything.
 */
export function reserveStart(token: { current: number }): () => boolean {
  const claimed = token.current + 1;
  token.current = claimed;
  return () => token.current === claimed;
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
  /**
   * Which start attempt is current.
   *
   * Every startItem is a chain of awaits — PlaybackInfo, attach, the Playing
   * report — and picking a second episode while the first is mid-chain used to
   * leave both of them writing status, stream and error state in whatever order
   * they happened to finish. A superseded attempt now stops at its next
   * checkpoint instead of reporting its own outcome over the live one.
   */
  const startTokenRef = useRef(0);
  const playbackStartRef = useRef(0);
  const subtitleOffsetRef = useRef(0);
  /**
   * The tracks the viewer asked for, held where they can be read synchronously.
   *
   * jellyfin-web keeps these on its mutable `playerData` and reads them back in
   * `changeStream`. Held only in React state they were read through callback
   * closures, so switching audio and then subtitles before the first re-render
   * landed sent the *previous* audio index back to Jellyfin and reverted the
   * track the viewer had just chosen.
   */
  const audioIndexRef = useRef<number | null>(null);
  const subtitleIndexRef = useRef<number | null>(null);
  /**
   * Whether the element has actually arrived at the position it was started at.
   *
   * A restarted HLS transcode attaches at currentTime 0 and only jumps to the
   * requested offset once hls.js has the level details — measured at around six
   * seconds against a 4K HDR transcode, against a ten-second progress cycle.
   * Every progress and stop report writes the resume point straight to the
   * member's item data, so reporting that transient zero is what would throw
   * away where they had got to.
   */
  const reachedStartRef = useRef(false);
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

  /** Tear down whatever is rendering subtitles, leaving the video alone. */
  const destroySubtitles = useCallback(() => {
    try { assRef.current?.dispose?.(); } catch { /* already torn down */ }
    assRef.current = null;
    if (mediaRef.current) clearTextTracks(mediaRef.current);
  }, []);

  const destroyPlayers = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    destroySubtitles();
  }, [destroySubtitles]);

  /**
   * Render one subtitle track onto the element that is already playing.
   *
   * Separate from attachMedia because switching between text tracks does not
   * need a new stream: jellyfin-web only re-requests one when the old or new
   * track has to be burned in (playbackmanager.js `setSubtitleStreamIndex`).
   * `index` below zero means "off", which is just the teardown.
   */
  const applySubtitleTrack = useCallback(async (next: HelprrStreamInfo, index: number | null) => {
    const el = mediaRef.current;
    if (!el) return;
    destroySubtitles();
    if (index == null || index < 0) return;
    // A track Jellyfin is burning in has no URL and nothing to attach — the
    // pixels already carry it.
    const selected = next.subtitleTracks.find((track) => track.index === index && track.deliveryMethod !== 'Encode')
      ?? next.subtitleTracks.find((track) => track.index === index);
    if (!selected?.url) return;

    if (selected.format === 'ass' || selected.format === 'ssa') {
      const { default: SubtitlesOctopus } = await import('@jellyfin/libass-wasm');
      const videoStream = next.mediaSource.MediaStreams?.find((candidate) => candidate.Type === 'Video');
      assRef.current = new SubtitlesOctopus({
        video: el,
        subUrl: selected.url,
        workerUrl: '/libass/subtitles-octopus-worker.js',
        legacyWorkerUrl: '/libass/subtitles-octopus-worker-legacy.js',
        fallbackFont: '/libass/default.woff2',
        fonts: fontUrls(next),
        timeOffset: ticksToSeconds(next.transcodingOffsetTicks) + subtitleOffsetRef.current,
        // libass is disposed by its own error path, so without a handler a
        // failed render just makes the subtitles vanish silently.
        onError: () => { assRef.current = null; },
        // The rest are jellyfin-web's settings verbatim (htmlVideoPlayer
        // `renderSsaAss`), which override every libass default. They matter
        // most on the typeset ASS this library is full of: the render caps keep
        // a 4K stream from rasterising at full resolution, the limits contain a
        // pathological subtitle file, and targetFps is what makes karaoke and
        // sign animations run at the video's own rate.
        renderMode: 'wasm-blend',
        dropAllAnimations: false,
        libassMemoryLimit: 40,
        libassGlyphLimit: 40,
        targetFps: videoStream?.ReferenceFrameRate || videoStream?.RealFrameRate || 24,
        prescaleFactor: 0.8,
        prescaleHeightLimit: 1080,
        maxRenderHeight: 2160,
        resizeVariation: 0.2,
        renderAhead: 90,
      });
      return;
    }

    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = selected.displayTitle;
    track.srclang = selected.language;
    track.src = selected.url;
    track.default = true;
    el.appendChild(track);
    const enable = () => {
      const textTrack = el.textTracks[0];
      if (!textTrack) return;
      textTrack.mode = 'showing';
      // ::cue cannot move a cue box, so the vertical-position setting has to be
      // written onto the cues themselves — the same lever jellyfin-web uses.
      applyCueLine(textTrack, cueLineRef.current);
    };
    track.addEventListener('load', enable);
    enable();
  }, [destroySubtitles]);

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
        // "Auto" quality still negotiates against the profile's 120 Mbps
        // ceiling, so the effective bitrate — not the picker's 0 — decides
        // this. jellyfin-web caps the buffer at 6s above 25 Mbps because
        // browsers choke on huge fragments from hardware encoders
        // (htmlVideoPlayer/plugin.js, hls.js#876); keyed off the raw setting a
        // 4K transcode kept the 30s buffer that comment warns about.
        const effectiveBitrate = maxBitrate > 0 ? maxBitrate : 120_000_000;
        const maxBufferLength = effectiveBitrate >= 25_000_000 ? 6 : 30;
        const hls = new Hls({
          startPosition: start || -1,
          manifestLoadingTimeOut: 20_000,
          maxBufferLength,
          maxMaxBufferLength: maxBufferLength,
          lowLatencyMode: false,
          // Keep the whole back buffer: the default 90s makes seeking back into
          // what was just watched re-download it. Both match jellyfin-web's
          // Hls.DefaultConfig overrides.
          backBufferLength: Infinity,
          // Pick the HDR rendition when the manifest offers one, or an HDR
          // transcode is silently watched in SDR.
          videoPreference: { preferHDR: true },
          xhrSetup(xhr) {
            xhr.withCredentials = true;
          },
        });
        // How many times a decode error has been nursed back. jellyfin-web
        // escalates recover -> swapAudioCodec+recover -> give up
        // (htmlMediaHelper.js `handleHlsJsMediaError`); recovering forever
        // leaves a genuinely broken stream spinning with no error on screen.
        let mediaErrorRecoveries = 0;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          // Checked before the fatal guard and before the retry below. hls.js
          // retries NETWORK_ERROR indefinitely, so any upstream refusal — a 409
          // for a revoked token, a 404 for an item the member lost access to, a
          // 500 from a dead transcode — would otherwise stall the stream
          // silently with no error ever reaching the media element. jellyfin-web
          // treats every response code at or above 400 as fatal here.
          if ((data.response?.code ?? 0) >= 400) {
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
            mediaErrorRecoveries += 1;
            if (mediaErrorRecoveries === 1) {
              hls.recoverMediaError();
              return;
            }
            if (mediaErrorRecoveries === 2) {
              hls.swapAudioCodec();
              hls.recoverMediaError();
              return;
            }
          }
          el.dispatchEvent(new Event('error'));
        });
        hls.loadSource(next.mediaUrl);
        hls.attachMedia(el);
        hlsRef.current = hls;
        // attachMedia swaps in a MediaSource URL asynchronously, so calling
        // play() straight after it races its own load. Waiting for the parsed
        // manifest is the point at which the element genuinely has a source.
        // The timeout is a backstop only: a manifest that never parses raises
        // ERROR above, which fails playback through the normal path.
        await new Promise<void>((resolve) => {
          const done = window.setTimeout(resolve, 10_000);
          hls.once(Hls.Events.MANIFEST_PARSED, () => {
            window.clearTimeout(done);
            resolve();
          });
        });
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

    await applySubtitleTrack(next, requestedSubtitleIndex ?? next.mediaSource.DefaultSubtitleStreamIndex ?? null);

    await playSafely(el);
  }, [applySubtitleTrack, destroyPlayers, failPlayback, maxBitrate, muted, playbackRate, volume]);

  const startItem = useCallback(async (nextItem: JellyfinItem, options: PlayOptions = {}) => {
    const stillCurrent = reserveStart(startTokenRef);
    const superseded = () => !stillCurrent();
    /**
     * The encoder the outgoing item is holding.
     *
     * Jellyfin keeps a transcode alive for its idle timeout after the client
     * stops reading it, so every switch that did not go through restartWith or
     * seek — next, previous, and now every pick from the queue panel — left one
     * running on the server. With an episode list in the player that is a click
     * away rather than a rarity, so it is released here, once the replacement
     * has actually been granted.
     */
    const outgoingSession = streamRef.current?.playSessionId;
    setStatus('loading');
    setError(null);
    setNeedsJellyfinConnect(false);
    playbackStartRef.current = Date.now() * 10_000;
    // The replacement element starts at zero until it seeks itself into place.
    reachedStartRef.current = false;
    const resumeTicks = options.startTimeTicks
      ?? nextItem.UserData?.PlaybackPositionTicks
      ?? 0;
    const request: PlayOptions = {
      startTimeTicks: resumeTicks,
      audioStreamIndex: options.audioStreamIndex,
      subtitleStreamIndex: options.subtitleStreamIndex,
      // Only meaningful alongside a track index, and only correct while the
      // item is unchanged — a source id from the outgoing item would ask
      // Jellyfin for a source this one does not have.
      mediaSourceId: options.mediaSourceId,
      maxStreamingBitrate: options.maxStreamingBitrate && options.maxStreamingBitrate > 0
        ? options.maxStreamingBitrate
        : undefined,
      enableDirectPlay: options.enableDirectPlay,
      enableDirectStream: options.enableDirectStream,
    };
    try {
      const nextStream = await fetchStream(nextItem.Id, request);
      if (outgoingSession && outgoingSession !== nextStream.playSessionId) {
        // Fire and forget: the viewer is waiting on the new stream, not on the
        // old one being tidied up.
        void stopEncodings(outgoingSession);
      }
      if (superseded()) {
        // This attempt lost the race, so nothing will ever read the session it
        // was just granted. Hand it back rather than leaving it to time out.
        void stopEncodings(nextStream.playSessionId);
        return;
      }
      streamRef.current = nextStream;
      setStream(nextStream);
      // What the viewer asked for wins over what came back. Jellyfin returns
      // the *file's* defaults in DefaultAudioStreamIndex/DefaultSubtitleStreamIndex
      // rather than echoing the request, so reading the response back here was
      // what reverted a chosen audio track — and then fed the stale index into
      // the next restart. jellyfin-web stores the requested index the same way
      // (playbackmanager.js `changeStream`).
      const chosenAudio = request.audioStreamIndex ?? nextStream.mediaSource.DefaultAudioStreamIndex ?? null;
      const chosenSubtitle = request.subtitleStreamIndex ?? nextStream.mediaSource.DefaultSubtitleStreamIndex ?? null;
      audioIndexRef.current = chosenAudio;
      subtitleIndexRef.current = chosenSubtitle;
      setAudioStreamIndex(chosenAudio);
      setSubtitleStreamIndex(chosenSubtitle);
      setDurationSeconds(ticksToSeconds(nextStream.mediaSource.RunTimeTicks || nextItem.RunTimeTicks));
      setVideoExpanded(nextItem.MediaType !== 'Audio');
      await attachMedia(nextStream, chosenSubtitle);
      if (superseded()) return;
      await report('playing', nextStream, {
        positionTicks: secondsToTicks(mediaRef.current?.currentTime || 0) || resumeTicks,
        isPaused: false,
        volumeLevel: Math.round(volume * 100),
        isMuted: muted,
        playbackRate,
        audioStreamIndex: chosenAudio,
        subtitleStreamIndex: chosenSubtitle,
        repeatMode: repeatRef.current,
        shuffleMode: shuffledRef.current ? 'Shuffle' : 'Sorted',
        playbackStartTimeTicks: playbackStartRef.current,
        maxStreamingBitrate: maxBitrate || undefined,
      });
      if (superseded()) return;
      setStatus('playing');
      fetch(`/api/jellyfin/catalog/items/${nextItem.Id}?expand=segments`)
        .then((res) => res.ok ? res.json() : null)
        .then((data: { segments?: MediaSegment[] } | null) => setSegments(data?.segments ?? []))
        .catch(() => setSegments([]));
    } catch (cause) {
      // A newer attempt owns the player now; this one's failure is not the
      // viewer's problem and must not replace what is actually on screen.
      if (superseded()) return;
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
    const resolved = await Promise.all(items.map(resolvePlayable));
    const { items: flat, index: queueIndex } = flattenPlayables(resolved, startIndex);

    orderRef.current = flat;
    const shouldShuffle = options?.shuffle ?? shuffled;
    if (options?.shuffle) {
      shuffledRef.current = true;
      setShuffled(true);
    }
    // Shuffling discards the requested position by definition — the whole
    // point is a new order — so it starts at the top of that order.
    const nextQueue = shouldShuffle ? shuffleInPlace(flat) : flat;
    indexRef.current = shouldShuffle
      ? 0
      : Math.min(queueIndex, Math.max(0, nextQueue.length - 1));
    queueRef.current = nextQueue;
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
    // No explicit startTimeTicks, so startItem falls back to the episode's own
    // resume position. Forcing 0 meant picking a half-watched episode out of
    // the panel restarted it, which is not what any episode row in the rest of
    // the app does.
    await startItem(nextItem);
  }, [startItem]);

  const stop = useCallback(async () => {
    // Retire any start still in flight, or it will finish into a player the
    // viewer has already closed.
    startTokenRef.current += 1;
    clearTimers();
    const current = streamRef.current;
    const el = mediaRef.current;
    if (current) {
      await report('stopped', current, {
        positionTicks: positionToReport(el, current, reachedStartRef.current)
          || secondsToTicks(positionSeconds),
        isPaused: true,
        volumeLevel: Math.round(volume * 100),
        isMuted: muted,
        playbackRate,
        audioStreamIndex: audioIndexRef.current,
        subtitleStreamIndex: subtitleIndexRef.current,
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
    audioIndexRef.current = null;
    subtitleIndexRef.current = null;
    setAudioStreamIndex(null);
    setSubtitleStreamIndex(null);
    setQueue([]);
    setIndex(0);
    setPositionSeconds(0);
    setDurationSeconds(0);
  }, [destroyPlayers, maxBitrate, muted, playbackRate, positionSeconds, volume]);

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
        const stillCurrent = reserveStart(startTokenRef);
        await stopEncodings(current.playSessionId);
        // Dragged again while the stop was in flight: the later seek wins.
        if (!stillCurrent()) return;
        const nextItem = queueRef.current[indexRef.current];
        if (!nextItem) return;
        await startItem(nextItem, {
          startTimeTicks: secondsToTicks(seconds),
          audioStreamIndex: audioIndexRef.current,
          subtitleStreamIndex: subtitleIndexRef.current,
          mediaSourceId: current.mediaSource.Id,
          maxStreamingBitrate: maxBitrate,
        });
      })();
      return;
    }
    el.currentTime = seconds;
    setPositionSeconds(seconds);
  }, [maxBitrate, startItem]);

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
    // The live stream and the queue disagree while a start is still in flight —
    // picking an episode and then a track before it had attached. That start
    // owns the player, and a source id from the outgoing item would ask
    // Jellyfin for a source this one does not have; it also sets the track
    // state itself when it lands, so the panel corrects rather than lying.
    if (current.item.Id !== nextItem.Id) return;
    // Read before the stop, not after it. Not the element's own time either: a
    // change made while a previous restart is still attaching would read the
    // transient zero and send the viewer back to the beginning. Switching
    // subtitles twice in a row hit this exactly.
    const startTimeTicks = positionToReport(mediaRef.current, current, reachedStartRef.current)
      || secondsToTicks(positionSeconds);
    const stillCurrent = reserveStart(startTokenRef);
    await stopEncodings(current.playSessionId);
    // A newer change was made while the stop was in flight, so that one owns
    // the player; finishing this chain would apply a selection the viewer has
    // already moved on from.
    if (!stillCurrent()) return;
    await startItem(nextItem, {
      startTimeTicks,
      // The refs, read here rather than passed in by the caller: every setter
      // writes them synchronously, so the restart that wins the claim above
      // carries the viewer's newest pick — including one made while this stop
      // was in flight, and including a client-side subtitle swap, which does
      // not restart at all and so has no restart of its own to carry it.
      audioStreamIndex: audioIndexRef.current,
      subtitleStreamIndex: subtitleIndexRef.current,
      // The source the indexes belong to, without which Jellyfin ignores them.
      mediaSourceId: current.mediaSource.Id,
      maxStreamingBitrate: patch.maxStreamingBitrate ?? maxBitrate,
      enableDirectPlay: patch.enableDirectPlay,
      enableDirectStream: patch.enableDirectStream,
    });
  }, [maxBitrate, positionSeconds, startItem]);

  const setAudioStream = useCallback(async (streamIndex: number) => {
    audioIndexRef.current = streamIndex;
    setAudioStreamIndex(streamIndex);
    await restartWith({});
  }, [restartWith]);

  /**
   * Switch subtitles, restarting the stream only when one has to be burned in.
   *
   * jellyfin-web swaps an External track on the element and leaves the stream
   * alone (playbackmanager.js `setSubtitleStreamIndex`); only a track Jellyfin
   * has to encode into the picture — PGS, VOBSUB — needs a new stream, and so
   * does turning one of those off. Restarting for every change made each toggle
   * a multi-second stall and started a fresh transcode, which is what made
   * flipping between two tracks a few times so punishing.
   */
  const setSubtitleStream = useCallback(async (streamIndex: number) => {
    const current = streamRef.current;
    const previousIndex = subtitleIndexRef.current;
    subtitleIndexRef.current = streamIndex;
    setSubtitleStreamIndex(streamIndex);
    if (!current) return;
    if (subtitleNeedsOwnStream(current, streamIndex) || subtitleNeedsOwnStream(current, previousIndex)) {
      await restartWith({});
      return;
    }
    await applySubtitleTrack(current, streamIndex);
  }, [applySubtitleTrack, restartWith]);

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
      if (el.currentTime > 0) reachedStartRef.current = true;
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
          audioStreamIndex: audioIndexRef.current,
          subtitleStreamIndex: subtitleIndexRef.current,
          mediaSourceId: current.mediaSource.Id,
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
  }, [failPlayback, maxBitrate, next, startItem]);

  useEffect(() => {
    clearTimers();
    if (status !== 'playing' && status !== 'paused') return undefined;
    progressTimer.current = setInterval(() => {
      const current = streamRef.current;
      const el = mediaRef.current;
      if (!current || !el) return;
      void report('progress', current, {
        positionTicks: positionToReport(el, current, reachedStartRef.current),
        isPaused: el.paused,
        volumeLevel: Math.round(el.volume * 100),
        isMuted: el.muted,
        playbackRate: el.playbackRate,
        audioStreamIndex: audioIndexRef.current,
        subtitleStreamIndex: subtitleIndexRef.current,
        repeatMode: repeatRef.current,
        shuffleMode: shuffledRef.current ? 'Shuffle' : 'Sorted',
        playbackStartTimeTicks: playbackStartRef.current,
        maxStreamingBitrate: maxBitrate || undefined,
      });
    }, 10_000);
    return clearTimers;
  }, [maxBitrate, status]);

  useEffect(() => {
    cueLineRef.current = subtitleCueLine(subtitleAppearance.verticalPosition);
    const textTrack = mediaRef.current?.textTracks?.[0];
    if (!textTrack) return;
    applyCueLine(textTrack, cueLineRef.current);
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
      beaconStopped(current, positionToReport(mediaRef.current, current, reachedStartRef.current));
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
      audioStreamIndex: audioIndexRef.current,
      subtitleStreamIndex: subtitleIndexRef.current,
      // Only when the stored stream is this item's — after a gate it may still
      // be the one that was playing before.
      mediaSourceId: streamRef.current?.item.Id === pending.Id
        ? streamRef.current.mediaSource.Id
        : undefined,
      maxStreamingBitrate: maxBitrate,
    });
  }, [maxBitrate, startItem]);

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
