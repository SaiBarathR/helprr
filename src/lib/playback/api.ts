// Browser-side Jellyfin playback client. Media bytes and session reporting go
// client → Jellyfin directly (never proxied through Next.js); the per-user
// token + reachable server URL come from /api/jellyfin/play/ticket. Browser-only.

import type {
  EpisodeSummary,
  MediaSourceInfo,
  PlayableItem,
  PlaybackInfoResponse,
  PlaybackMediaStream,
  PlaybackProgressReport,
  PlaybackStartReport,
  PlaybackStopReport,
  PlayMethod,
  PlayTicket,
} from '@/types/jellyfin-playback';
import { buildDeviceProfile, DEFAULT_MAX_STREAMING_BITRATE } from '@/lib/playback/device-profile';
import { getDeviceId } from '@/lib/playback/device-id';

const CLIENT_NAME = 'Helprr Web';
const CLIENT_VERSION = '1.0.0';

/** A ticket that is ready to stream with (status === 'ok'). */
export interface OkTicket {
  status: 'ok';
  serverUrl: string;
  userId: string;
  token: string;
}

export class JellyfinPlaybackError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'JellyfinPlaybackError';
    this.status = status;
  }
}

// ── Ticket ────────────────────────────────────────────────────────────────────

let cachedTicket: OkTicket | null = null;

export async function getTicket(options: { force?: boolean } = {}): Promise<PlayTicket> {
  if (!options.force && cachedTicket) return cachedTicket;
  const res = await fetch('/api/jellyfin/play/ticket');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new JellyfinPlaybackError(body?.error ?? 'Failed to fetch playback ticket', res.status);
  }
  const ticket = (await res.json()) as PlayTicket;
  cachedTicket = ticket.status === 'ok' ? (ticket as OkTicket) : null;
  return ticket;
}

/** Drop the cached ticket — call when Jellyfin 401s (stale token) or after a relink. */
export function invalidateTicket(): void {
  cachedTicket = null;
}

// ── Auth header / fetch ───────────────────────────────────────────────────────

/** Rough OS-level device name so sessions are recognizable in the JF dashboard. */
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'Helprr iPhone';
  if (/iPad/.test(ua)) return 'Helprr iPad';
  if (/Android/.test(ua)) return 'Helprr Android';
  if (/Mac/.test(ua)) return 'Helprr Mac';
  if (/Windows/.test(ua)) return 'Helprr Windows';
  return CLIENT_NAME;
}

export function buildAuthHeader(token: string): string {
  return `MediaBrowser Client="${CLIENT_NAME}", Device="${deviceName()}", DeviceId="${getDeviceId()}", Version="${CLIENT_VERSION}", Token="${token}"`;
}

async function jfFetch<T>(ticket: OkTicket, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ticket.serverUrl}${path}`, {
    ...init,
    headers: {
      Authorization: buildAuthHeader(ticket.token),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    invalidateTicket();
    throw new JellyfinPlaybackError('Jellyfin session expired', 401);
  }
  if (!res.ok) {
    throw new JellyfinPlaybackError(`Jellyfin request failed (${res.status})`, res.status);
  }
  // Reporting endpoints return 204 No Content.
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => undefined)) as T;
}

// ── Item fetch ────────────────────────────────────────────────────────────────

/** The played item with everything the player surface needs in one fetch. */
export async function getItem(ticket: OkTicket, itemId: string): Promise<PlayableItem> {
  const params = new URLSearchParams({
    UserId: ticket.userId,
    Fields: 'Chapters,Trickplay,MediaSources,MediaStreams',
  });
  return jfFetch<PlayableItem>(ticket, `/Items/${itemId}?${params}`);
}

/**
 * The episode that follows `itemId` for the autoplay overlay (plan §F):
 * AdjacentTo spans season boundaries; NextUp covers adjacency gaps.
 */
export async function getNextEpisode(
  ticket: OkTicket,
  seriesId: string,
  itemId: string
): Promise<EpisodeSummary | null> {
  const params = new URLSearchParams({ UserId: ticket.userId, AdjacentTo: itemId });
  const adjacent = await jfFetch<{ Items?: EpisodeSummary[] }>(
    ticket,
    `/Shows/${seriesId}/Episodes?${params}`
  );
  const items = adjacent.Items ?? [];
  const index = items.findIndex((e) => e.Id === itemId);
  if (index >= 0 && index + 1 < items.length) return items[index + 1];

  const nextUpParams = new URLSearchParams({ UserId: ticket.userId, SeriesId: seriesId });
  const nextUp = await jfFetch<{ Items?: EpisodeSummary[] }>(
    ticket,
    `/Shows/NextUp?${nextUpParams}`
  );
  const candidate = nextUp.Items?.[0];
  return candidate && candidate.Id !== itemId ? candidate : null;
}

// ── Playback negotiation ──────────────────────────────────────────────────────

export interface PlaybackInfoOptions {
  startTimeTicks?: number;
  mediaSourceId?: string;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
  /** Caps both the request and the DeviceProfile; drives the quality selector. */
  maxStreamingBitrate?: number;
  /** Set false to force a transcode (manual quality selection). */
  enableDirectPlay?: boolean;
  enableDirectStream?: boolean;
}

export async function getPlaybackInfo(
  ticket: OkTicket,
  itemId: string,
  options: PlaybackInfoOptions = {}
): Promise<PlaybackInfoResponse> {
  const maxBitrate = options.maxStreamingBitrate ?? DEFAULT_MAX_STREAMING_BITRATE;
  return jfFetch<PlaybackInfoResponse>(
    ticket,
    `/Items/${itemId}/PlaybackInfo?UserId=${encodeURIComponent(ticket.userId)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        UserId: ticket.userId,
        DeviceProfile: buildDeviceProfile(maxBitrate),
        MaxStreamingBitrate: maxBitrate,
        StartTimeTicks: options.startTimeTicks ?? 0,
        MediaSourceId: options.mediaSourceId,
        AudioStreamIndex: options.audioStreamIndex,
        SubtitleStreamIndex: options.subtitleStreamIndex,
        EnableDirectPlay: options.enableDirectPlay ?? true,
        EnableDirectStream: options.enableDirectStream ?? true,
        AutoOpenLiveStream: true,
        IsPlayback: true,
      }),
    }
  );
}

// ── Session reporting (live sessions in the JF dashboard + resume positions) ──

export async function reportPlaybackStart(ticket: OkTicket, info: PlaybackStartReport): Promise<void> {
  await jfFetch<void>(ticket, '/Sessions/Playing', { method: 'POST', body: JSON.stringify(info) });
}

export async function reportPlaybackProgress(
  ticket: OkTicket,
  info: PlaybackProgressReport
): Promise<void> {
  await jfFetch<void>(ticket, '/Sessions/Playing/Progress', {
    method: 'POST',
    body: JSON.stringify(info),
  });
}

/**
 * Best-effort stop report — fired from `pagehide`/unmount, so it uses a
 * keepalive fetch and swallows failures (orphaned sessions are cleaned up by
 * Jellyfin's own session timeout).
 */
export function reportPlaybackStopped(ticket: OkTicket, info: PlaybackStopReport): void {
  void fetch(`${ticket.serverUrl}/Sessions/Playing/Stopped`, {
    method: 'POST',
    keepalive: true,
    headers: {
      Authorization: buildAuthHeader(ticket.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(info),
  }).catch(() => {});
}

/**
 * Kill this device's active transcode before renegotiating (audio/quality
 * switch) — and on player teardown, where keepalive lets the DELETE survive
 * the document being torn down (tab close / PWA kill).
 */
export async function stopEncoding(ticket: OkTicket, playSessionId: string): Promise<void> {
  const params = new URLSearchParams({ deviceId: getDeviceId(), playSessionId });
  await jfFetch<void>(ticket, `/Videos/ActiveEncodings?${params}`, {
    method: 'DELETE',
    keepalive: true,
  });
}

// ── Stream / subtitle / trickplay URL builders ────────────────────────────────

/** Progressive URL for a direct-play/direct-stream media source. */
export function buildDirectStreamUrl(
  ticket: OkTicket,
  itemId: string,
  source: MediaSourceInfo
): string {
  // Container can be an ffmpeg alias list ("mov,mp4,m4a,…") — first entry wins.
  const container = (source.Container ?? 'mp4').split(',')[0];
  const params = new URLSearchParams({
    Static: 'true',
    MediaSourceId: source.Id,
    DeviceId: getDeviceId(),
    api_key: ticket.token,
  });
  if (source.ETag) params.set('Tag', source.ETag);
  return `${ticket.serverUrl}/Videos/${itemId}/stream.${container}?${params}`;
}

/** Absolute HLS URL for a transcoding media source, or null when not transcoding. */
export function buildTranscodeUrl(ticket: OkTicket, source: MediaSourceInfo): string | null {
  if (!source.TranscodingUrl) return null;
  const url = new URL(source.TranscodingUrl, ticket.serverUrl);
  // JF 10.11 embeds the caller's token as `ApiKey`; older versions omit auth
  // entirely — append it only when neither spelling is present.
  if (!url.searchParams.has('api_key') && !url.searchParams.has('ApiKey')) {
    url.searchParams.set('api_key', ticket.token);
  }
  return url.toString();
}

/** VTT URL for an external text subtitle stream (the `<track>` fast path). */
export function buildSubtitleUrl(
  ticket: OkTicket,
  itemId: string,
  mediaSourceId: string,
  stream: PlaybackMediaStream
): string {
  if (stream.DeliveryUrl) {
    const url = new URL(stream.DeliveryUrl, ticket.serverUrl);
    if (!url.searchParams.has('api_key')) url.searchParams.set('api_key', ticket.token);
    return url.toString();
  }
  return `${ticket.serverUrl}/Videos/${itemId}/${mediaSourceId}/Subtitles/${stream.Index}/0/Stream.vtt?api_key=${encodeURIComponent(ticket.token)}`;
}

// ── Music (universal audio endpoint, plan §G) ─────────────────────────────────

const ALWAYS_PLAYABLE_AUDIO = ['mp3', 'aac', 'm4a|aac', 'm4b|aac', 'wav'];

let probeAudio: HTMLAudioElement | null = null;
function canPlayAudio(type: string): boolean {
  if (!probeAudio) probeAudio = document.createElement('audio');
  return probeAudio.canPlayType(type) !== '';
}

/**
 * Containers this browser can direct-play (the universal endpoint's `Container`
 * list, `container|codec` syntax included); everything else transcodes to mp3.
 */
function supportedAudioContainers(): string[] {
  const containers = [...ALWAYS_PLAYABLE_AUDIO];
  if (canPlayAudio('audio/flac')) containers.push('flac');
  if (canPlayAudio('audio/ogg; codecs="vorbis"')) containers.push('ogg', 'oga');
  if (canPlayAudio('audio/ogg; codecs="opus"')) containers.push('opus');
  if (canPlayAudio('audio/webm; codecs="opus"')) containers.push('webm|opus', 'webma');
  return containers;
}

/** Best guess at how the universal endpoint will serve this container, for session reports. */
export function audioPlayMethod(container: string | undefined): PlayMethod {
  if (!container) return 'DirectPlay';
  const supported = supportedAudioContainers().map((c) => c.split('|')[0]);
  return container
    .split(',')
    .some((c) => supported.includes(c.trim().toLowerCase()))
    ? 'DirectPlay'
    : 'Transcode';
}

/**
 * Stream URL for a music track. The universal endpoint direct-plays containers
 * the browser supports and falls back to an mp3 transcode for everything else
 * (e.g. flac on browsers without flac support).
 */
export function buildAudioStreamUrl(
  ticket: OkTicket,
  itemId: string,
  playSessionId: string
): string {
  const params = new URLSearchParams({
    UserId: ticket.userId,
    DeviceId: getDeviceId(),
    api_key: ticket.token,
    PlaySessionId: playSessionId,
    Container: supportedAudioContainers().join(','),
    TranscodingContainer: 'mp3',
    TranscodingProtocol: 'http',
    AudioCodec: 'mp3',
    // High cap so supported containers always direct-play; the server picks a
    // sane mp3 bitrate for the transcode path on its own.
    MaxStreamingBitrate: String(DEFAULT_MAX_STREAMING_BITRATE),
    EnableRedirection: 'true',
    EnableRemoteMedia: 'false',
  });
  return `${ticket.serverUrl}/Audio/${itemId}/universal?${params}`;
}

/** Artwork for MediaSession/lock-screen (Jellyfin image endpoints are unauthenticated). */
export function buildPrimaryImageUrl(ticket: OkTicket, itemId: string, maxWidth = 512): string {
  return `${ticket.serverUrl}/Items/${itemId}/Images/Primary?maxWidth=${maxWidth}&quality=90`;
}

/** Tile-sheet JPEG for scrubber previews (CSS-sprite indexed). */
export function buildTrickplayUrl(
  ticket: OkTicket,
  itemId: string,
  width: number,
  tileIndex: number,
  mediaSourceId?: string
): string {
  const params = new URLSearchParams({ api_key: ticket.token });
  if (mediaSourceId) params.set('MediaSourceId', mediaSourceId);
  return `${ticket.serverUrl}/Videos/${itemId}/Trickplay/${width}/${tileIndex}.jpg?${params}`;
}
