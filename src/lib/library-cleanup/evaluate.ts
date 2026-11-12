// Pure rule evaluation for library cleanup. Everything it needs is gathered
// beforehand (inputs.ts) into one TitleFacts per Sonarr/Radarr title, so the
// rule, every exclusion and the execute-time re-check are one tested function.

import type { LibraryMediaType, LibraryRule } from './config';

const DAY_MS = 24 * 60 * 60 * 1000;
const GB = 1024 ** 3;

export interface TitleFacts {
  mediaType: LibraryMediaType;
  service: 'RADARR' | 'SONARR';
  instanceId: string;
  instanceLabel: string;
  arrId: number;
  title: string;
  year: number | null;
  tmdbId: number | null;
  tvdbId: number | null;
  imdbId: string | null;
  posterUrl: string | null;
  sizeBytes: number;
  /** ISO date the title was added to Sonarr/Radarr. */
  added: string | null;
  /** 0–10 score, or null when the arr has none. */
  rating: number | null;
  /** Whether the title carries the configured keep tag. */
  keepTagged: boolean;
  /** Whether any Jellyfin item matched the title by provider id. */
  inJellyfin: boolean;
  /** The Jellyfin items that matched (to spot it playing right before a delete). */
  jellyfinIds?: string[];
  /** Latest play by any Jellyfin user, or null. */
  lastWatchedAt: Date | null;
  /** Someone played it but Jellyfin has no date for that play. */
  watchedWithoutDate: boolean;
  /** Helprr users with the title on their watchlist. */
  watchlistUserIds: string[];
  /** A Seerr request (or Helprr pending request) that is not finished. */
  openRequest: boolean;
  /** The newest request's creation time, if any. */
  latestRequestAt: Date | null;
  /** Display names of everyone who requested it. */
  requestedBy: string[];
  /** Helprr users behind those requests (via their linked Seerr account). */
  requesterUserIds: string[];
  /** Listed in that instance's download queue. */
  downloading: boolean;
}

export interface TitleEvaluation {
  qualifies: boolean;
  /** Why it qualifies (empty unless it does). */
  reasons: string[];
  /** Exclusions that protect it. Always checked, never configurable. */
  exclusions: string[];
}

export function titleKey(t: { service: string; instanceId: string; arrId: number }): string {
  return `${t.service}:${t.instanceId}:${t.arrId}`;
}

function daysAgo(date: Date, now: number): number {
  return Math.floor((now - date.getTime()) / DAY_MS);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "Added today" rather than "Added 0 days ago". */
function whenLabel(what: string, date: Date, now: number): string {
  const days = daysAgo(date, now);
  return days === 0 ? `${what} today` : `${what} ${plural(days, 'day')} ago`;
}

/**
 * The always-on exclusions, shared by the preview and the execute-time re-check.
 * Anything that cannot be confirmed safe is excluded (unknown dates, no match in
 * Jellyfin, no files).
 */
export function exclusionsFor(
  t: TitleFacts,
  unwatchedDays: number,
  keepTag: string,
  now: number,
  /** For a marked title: when it was marked, so a watch or request during the countdown always protects it. */
  markedAt?: Date,
): string[] {
  const out: string[] = [];
  const windowStart = Math.min(now - unwatchedDays * DAY_MS, markedAt?.getTime() ?? Infinity);
  if (t.keepTagged) out.push(`Tagged "${keepTag}"`);
  if (t.watchlistUserIds.length > 0) out.push('On a watchlist');
  if (t.openRequest) out.push('Open request');
  if (t.latestRequestAt && t.latestRequestAt.getTime() >= windowStart) out.push(markedAt ? 'Requested recently' : `Requested in the last ${plural(unwatchedDays, 'day')}`);
  if (t.downloading) out.push('Downloading');
  if (t.lastWatchedAt && t.lastWatchedAt.getTime() >= windowStart) out.push(markedAt ? 'Watched recently' : `Watched in the last ${plural(unwatchedDays, 'day')}`);
  if (t.watchedWithoutDate) out.push('Watched, date unknown');
  if (!t.inJellyfin) out.push('Not found in Jellyfin');
  if (!(t.sizeBytes > 0)) out.push('No files on disk');
  return out;
}

export function evaluateTitle(t: TitleFacts, rule: LibraryRule, keepTag: string, now: number): TitleEvaluation {
  const exclusions = exclusionsFor(t, rule.unwatchedDays, keepTag, now);
  const reasons: string[] = [];
  let meets = true;

  const added = t.added ? new Date(t.added) : null;
  if (!added || !Number.isFinite(added.getTime())) {
    exclusions.push('Unknown added date');
    meets = false;
  } else if (now - added.getTime() > rule.addedDays * DAY_MS) {
    reasons.push(whenLabel('Added', added, now));
  } else {
    meets = false;
  }

  if (t.lastWatchedAt) reasons.push(whenLabel('Last watched', t.lastWatchedAt, now));
  else reasons.push('Never watched');

  if (rule.minSizeGb !== null) {
    if (t.sizeBytes >= rule.minSizeGb * GB) reasons.push(`At least ${rule.minSizeGb} GB`);
    else meets = false;
  }

  if (rule.maxRating !== null) {
    if (t.rating !== null && t.rating < rule.maxRating) reasons.push(`Rated ${t.rating.toFixed(1)}`);
    else meets = false;
  }

  const qualifies = meets && exclusions.length === 0;
  return { qualifies, reasons: qualifies ? reasons : [], exclusions };
}
