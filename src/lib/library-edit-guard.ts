import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';

// ─────────────────────────────────────────────────────────────────────────────
// Server-side payload-diff guard for Sonarr/Radarr PUT (locked decision #7).
//
// A member with series.view can still craft a raw PUT to flip monitoring, edit
// tags, or move the root folder. We diff the submitted body against the current
// item and 403 if a protected field changed without the matching capability.
//
// Absence is treated as a change to the API default for tags (→ []) and
// monitoring (→ false), because Sonarr/Radarr bind a missing field to its
// default and would otherwise let a member clear tags / unmonitor by simply
// omitting the field. Path is only flagged on an explicit differing value
// (an empty path is rejected upstream, not a silent move).
// ─────────────────────────────────────────────────────────────────────────────

export interface LibraryEditDiff {
  tags: boolean;
  path: boolean;
  monitoring: boolean;
  // True when the body changes a protected settings field (quality profile, type,
  // folder/availability options). No capability covers these — they are admin-only,
  // so a non-admin who trips this is rejected outright.
  other: boolean;
}

export interface LibraryEditCaps {
  tags: Capability;
  path: Capability;
  monitoring: Capability;
}

// Settings fields a member must never change. There is no capability for them, so
// for non-admins any explicit change here is forbidden. Kept as an explicit list
// (rather than diffing the whole object) because the client round-trips the entire
// series/movie object, whose volatile fields (statistics, airing dates, ratings)
// drift between fetch and PUT and would otherwise false-positive. Review this list
// if Sonarr/Radarr add new editable settings to their PUT schema.
const SERIES_PROTECTED_KEYS = [
  'qualityProfileId',
  'languageProfileId',
  'seriesType',
  'seasonFolder',
  'monitorNewItems',
] as const;

const MOVIE_PROTECTED_KEYS = ['qualityProfileId', 'minimumAvailability'] as const;

const ARTIST_PROTECTED_KEYS = ['qualityProfileId', 'metadataProfileId', 'monitorNewItems'] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Whether the body explicitly sets a protected settings field to a value differing
 * from the live item. Only a present, differing primitive counts — an omitted field
 * isn't treated as a change (the member UI sends the full object, so omission only
 * happens on a crafted body, which the upstream API validates).
 */
function protectedFieldChanged(
  current: unknown,
  body: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const cur = asRecord(current);
  for (const key of keys) {
    if (!(key in body)) continue;
    const submitted = body[key];
    if (submitted === undefined) continue;
    if (submitted !== cur[key]) return true;
  }
  return false;
}

function tagSetChanged(current: number[] | undefined, submitted: unknown): boolean {
  const cur = new Set((current ?? []).map(Number));
  const next = new Set((Array.isArray(submitted) ? submitted : []).map(Number));
  if (cur.size !== next.size) return true;
  for (const t of next) if (!cur.has(t)) return true;
  return false;
}

function normPath(p: string): string {
  return p.replace(/[\\/]+$/, '');
}

/** Whether `child` lives under `parent`, matching on full path segments (not raw
 * string prefix) so `/media/tv-shows` is NOT considered under `/media/tv`. */
function isUnder(child: string, parent: string): boolean {
  const c = normPath(child);
  const p = normPath(parent);
  return c === p || c.startsWith(`${p}/`) || c.startsWith(`${p}\\`);
}

function pathChanged(currentPath: string | undefined, body: Record<string, unknown>): boolean {
  const submittedPath = typeof body.path === 'string' ? body.path : undefined;
  if (submittedPath !== undefined && submittedPath !== currentPath) return true;

  const submittedRoot = typeof body.rootFolderPath === 'string' ? body.rootFolderPath : undefined;
  if (submittedRoot !== undefined && currentPath !== undefined) {
    // A new root folder the current full path doesn't already live under = a move.
    // Segment-aware so a sibling root (/media/tv vs /media/tv-shows) is still a move.
    if (!isUnder(currentPath, submittedRoot)) return true;
  }
  return false;
}

/** Diff a Sonarr series PUT body (has per-season monitoring) against the current series. */
export function diffSeriesEdit(
  current: {
    path?: string;
    monitored?: boolean;
    tags?: number[];
    seasons?: { seasonNumber: number; monitored: boolean }[];
  },
  submittedBody: unknown
): LibraryEditDiff {
  const body = asRecord(submittedBody);

  const tags = tagSetChanged(current.tags, body.tags);
  const path = pathChanged(current.path, body);

  const submittedMonitored = typeof body.monitored === 'boolean' ? body.monitored : false;
  let monitoring = submittedMonitored !== (current.monitored ?? false);

  if (!monitoring && Array.isArray(body.seasons) && Array.isArray(current.seasons)) {
    const currentByNumber = new Map(current.seasons.map((s) => [s.seasonNumber, s.monitored]));
    for (const raw of body.seasons) {
      const season = asRecord(raw);
      const num = typeof season.seasonNumber === 'number' ? season.seasonNumber : undefined;
      const mon = typeof season.monitored === 'boolean' ? season.monitored : undefined;
      if (num !== undefined && mon !== undefined && currentByNumber.has(num) && currentByNumber.get(num) !== mon) {
        monitoring = true;
        break;
      }
    }
  }

  const other = protectedFieldChanged(current, body, SERIES_PROTECTED_KEYS);

  return { tags, path, monitoring, other };
}

/** Diff a Radarr movie PUT body (no seasons) against the current movie. */
export function diffMovieEdit(
  current: { path?: string; monitored?: boolean; tags?: number[] },
  submittedBody: unknown
): LibraryEditDiff {
  const body = asRecord(submittedBody);
  const submittedMonitored = typeof body.monitored === 'boolean' ? body.monitored : false;
  return {
    tags: tagSetChanged(current.tags, body.tags),
    path: pathChanged(current.path, body),
    monitoring: submittedMonitored !== (current.monitored ?? false),
    other: protectedFieldChanged(current, body, MOVIE_PROTECTED_KEYS),
  };
}

/** Diff a Lidarr artist PUT body (no seasons) against the current artist. */
export function diffArtistEdit(
  current: { path?: string; monitored?: boolean; tags?: number[] },
  submittedBody: unknown
): LibraryEditDiff {
  const body = asRecord(submittedBody);
  const submittedMonitored = typeof body.monitored === 'boolean' ? body.monitored : false;
  return {
    tags: tagSetChanged(current.tags, body.tags),
    path: pathChanged(current.path, body),
    monitoring: submittedMonitored !== (current.monitored ?? false),
    other: protectedFieldChanged(current, body, ARTIST_PROTECTED_KEYS),
  };
}

/**
 * Given a computed diff and the caps that gate each field, return a 403 if the
 * current (non-admin) user lacks a capability for a field they changed, else null.
 * No-op (and no DB load) when nothing protected changed.
 */
export async function guardLibraryEdit(
  diff: LibraryEditDiff,
  caps: LibraryEditCaps
): Promise<NextResponse | null> {
  if (!diff.tags && !diff.path && !diff.monitoring && !diff.other) return null;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role === 'admin') return null;

  // Protected settings have no capability — only an admin may change them.
  if (diff.other) {
    return NextResponse.json(
      { error: 'Forbidden: only an admin can change these fields' },
      { status: 403 }
    );
  }

  const missing: Capability[] = [];
  if (diff.tags && !can(user, caps.tags)) missing.push(caps.tags);
  if (diff.path && !can(user, caps.path)) missing.push(caps.path);
  if (diff.monitoring && !can(user, caps.monitoring)) missing.push(caps.monitoring);

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Forbidden: you cannot change ${missing.join(', ')}` },
      { status: 403 }
    );
  }
  return null;
}
