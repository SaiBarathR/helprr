import type { TorrentTracker } from '@/lib/qbittorrent-client';
import { isPseudoTracker, trackersForViewer } from '@/lib/qbittorrent-tracker-links';

/*
 * Adding, editing and removing a torrent's trackers. Only an admin is shown
 * full announce URLs (see qbittorrent-tracker-links.ts), so an edit or a
 * removal names a tracker by its place in qBittorrent's list, with what the
 * browser was shown there and how long the list was; the server reads the list
 * again and takes the URL from it. qBittorrent reorders its list when trackers
 * change, so a place whose entry or list length differs is refused rather than
 * guessed at.
 */

// Spelled out, not only parsed: WHATWG URL also reads `http:host/x` and `https://host\x`, which qBittorrent's parser does not.
const TRACKER_PREFIX = /^(?:https?|udp|wss):\/\//i;
const MAX_TRACKER_URL_LENGTH = 2048;
/** A pasted public tracker list runs to about a hundred lines. */
export const MAX_TRACKERS_PER_ADD = 100;

/**
 * A tracker URL as typed, or null. qBittorrent takes anything (it lists `not a
 * url` as a tracker), and it splits addTrackers' `urls` on newlines and
 * removeTrackers' on `|`, so whitespace, control and invisible format
 * characters, `|` and `\` are refused rather than letting one value become
 * several entries (or a tracker that can never work).
 */
export function parseTrackerUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > MAX_TRACKER_URL_LENGTH || !TRACKER_PREFIX.test(url) || /[\s|\\\p{Cc}\p{Cf}]/u.test(url)) return null;
  try {
    return new URL(url).hostname ? url : null;
  } catch {
    return null;
  }
}

export type TrackerUrlsResult = { ok: true; urls: string[] } | { ok: false; error: string };

/** The URLs to add, without repeats: each one must parse, and there must be 1 to MAX_TRACKERS_PER_ADD. */
export function parseTrackerUrls(value: unknown): TrackerUrlsResult {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: 'Enter at least one tracker URL' };
  if (value.length > MAX_TRACKERS_PER_ADD) {
    return { ok: false, error: `Add at most ${MAX_TRACKERS_PER_ADD} trackers at a time` };
  }
  const urls: string[] = [];
  for (const [i, entry] of value.entries()) {
    const url = parseTrackerUrl(entry);
    if (!url) return { ok: false, error: trackerUrlError(value.length > 1 ? i + 1 : null) };
    if (!urls.includes(url)) urls.push(url);
  }
  return { ok: true, urls };
}

export function trackerUrlError(line: number | null): string {
  const what = line === null ? 'That' : `Line ${line}`;
  return `${what} isn't a tracker URL: it must start with http://, https://, udp:// or wss:// and have no spaces or |`;
}

/**
 * Where the browser saw the tracker: its place in qBittorrent's list, what it
 * was shown there and its tier (two trackers on one host look alike to anyone
 * but an admin), and the list's length.
 */
export interface TrackerRef {
  index: number;
  shown: string;
  tier: number;
  count: number;
}

export function parseTrackerRef(body: Record<string, unknown>): TrackerRef | null {
  const { index, shown, tier, count } = body;
  if (!Number.isInteger(index) || (index as number) < 0) return null;
  if (!Number.isInteger(count) || (count as number) <= (index as number)) return null;
  if (!Number.isInteger(tier)) return null;
  if (typeof shown !== 'string' || shown.length === 0 || shown.length > MAX_TRACKER_URL_LENGTH) return null;
  return { index: index as number, shown, tier: tier as number, count: count as number };
}

export type ResolvedTracker =
  | { ok: true; url: string }
  | { ok: false; reason: 'changed' | 'pseudo' };

/**
 * The full URL of the tracker the browser named, from qBittorrent's current
 * list. The entry at that place must still show the same to this viewer (the
 * full URL for an admin, `scheme://host[:port]` for anyone else) in the same
 * tier, and the list must be as long as it was; DHT, PeX and LSD are not trackers to change.
 */
export function resolveTracker(trackers: TorrentTracker[], ref: TrackerRef, fullUrls: boolean): ResolvedTracker {
  const tracker = trackers[ref.index];
  if (!tracker || trackers.length !== ref.count) return { ok: false, reason: 'changed' };
  if (isPseudoTracker(tracker.url)) return { ok: false, reason: 'pseudo' };
  if (tracker.tier !== ref.tier || trackersForViewer([tracker], fullUrls)[0].url !== ref.shown) return { ok: false, reason: 'changed' };
  return { ok: true, url: tracker.url };
}
