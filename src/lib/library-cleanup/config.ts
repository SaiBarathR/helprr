// Library cleanup ("Leaving soon") settings: one admin rule per library type
// plus the shared options. Every write (the Library tab and settings import)
// goes through normalizeLibraryCleanupSettings, so a stored value is always valid.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export type LibraryMediaType = 'movie' | 'series';
export const LIBRARY_MEDIA_TYPES: readonly LibraryMediaType[] = ['movie', 'series'];

export function isLibraryMediaType(value: unknown): value is LibraryMediaType {
  return value === 'movie' || value === 'series';
}

export interface LibraryRule {
  /** N: nobody watched it in N days. Also the window for "recent request" and "watched recently". */
  unwatchedDays: number;
  /** M: added to Sonarr/Radarr more than M days ago. */
  addedDays: number;
  /** Optional: only titles at least this big (GB, 1024³ bytes). */
  minSizeGb: number | null;
  /** Optional: only titles rated below this (0–10). A title with no rating never qualifies. */
  maxRating: number | null;
}

export interface LibraryCleanupSettings {
  keepTag: string;
  countdownDays: number;
  notifyOnMark: boolean;
  importListExclusion: boolean;
  movieRule: LibraryRule;
  seriesRule: LibraryRule;
}

export const DEFAULT_LIBRARY_RULE: LibraryRule = {
  unwatchedDays: 180,
  addedDays: 90,
  minSizeGb: null,
  maxRating: null,
};

export const DEFAULT_LIBRARY_CLEANUP_SETTINGS: LibraryCleanupSettings = {
  keepTag: 'keep',
  countdownDays: 14,
  notifyOnMark: true,
  importListExclusion: false,
  movieRule: DEFAULT_LIBRARY_RULE,
  seriesRule: DEFAULT_LIBRARY_RULE,
};

// Sonarr and Radarr only accept lowercase letters, digits and hyphens in tag labels.
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;

type Normalized<T> = { ok: true; value: T } | { ok: false; error: string };

function intIn(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function optionalNumberIn(value: unknown, min: number, max: number): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

function normalizeRule(value: unknown, label: string): Normalized<LibraryRule> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: `${label}: rule is missing` };
  const r = value as Record<string, unknown>;
  const unwatchedDays = intIn(r.unwatchedDays, 1, 3650);
  if (unwatchedDays === null) return { ok: false, error: `${label}: "not watched in" must be 1–3650 days` };
  const addedDays = intIn(r.addedDays, 0, 3650);
  if (addedDays === null) return { ok: false, error: `${label}: "added more than" must be 0–3650 days` };
  const minSizeGb = optionalNumberIn(r.minSizeGb, 0, 100_000);
  if (minSizeGb === undefined) return { ok: false, error: `${label}: minimum size must be 0–100000 GB` };
  const maxRating = optionalNumberIn(r.maxRating, 0, 10);
  if (maxRating === undefined) return { ok: false, error: `${label}: rating cut-off must be 0–10` };
  return { ok: true, value: { unwatchedDays, addedDays, minSizeGb, maxRating } };
}

export function normalizeLibraryCleanupSettings(value: unknown): Normalized<LibraryCleanupSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Settings must be an object' };
  const v = value as Record<string, unknown>;
  const keepTag = typeof v.keepTag === 'string' ? v.keepTag.trim().toLowerCase() : '';
  if (!TAG_PATTERN.test(keepTag)) {
    return { ok: false, error: 'Keep tag must be 1–50 lowercase letters, digits or hyphens' };
  }
  const countdownDays = intIn(v.countdownDays, 1, 365);
  if (countdownDays === null) return { ok: false, error: 'Countdown must be 1–365 days' };
  if (typeof v.notifyOnMark !== 'boolean' || typeof v.importListExclusion !== 'boolean') {
    return { ok: false, error: 'notifyOnMark and importListExclusion must be true or false' };
  }
  const movieRule = normalizeRule(v.movieRule, 'Movies');
  if (!movieRule.ok) return movieRule;
  const seriesRule = normalizeRule(v.seriesRule, 'Series');
  if (!seriesRule.ok) return seriesRule;
  return {
    ok: true,
    value: {
      keepTag,
      countdownDays,
      notifyOnMark: v.notifyOnMark,
      importListExclusion: v.importListExclusion,
      movieRule: movieRule.value,
      seriesRule: seriesRule.value,
    },
  };
}

function storedRule(value: Prisma.JsonValue | null): LibraryRule {
  const parsed = normalizeRule(value, 'stored');
  return parsed.ok ? parsed.value : DEFAULT_LIBRARY_RULE;
}

export async function loadLibraryCleanupSettings(): Promise<LibraryCleanupSettings> {
  const row = await prisma.libraryCleanupConfig.findUnique({ where: { id: 'singleton' } });
  if (!row) return DEFAULT_LIBRARY_CLEANUP_SETTINGS;
  return {
    keepTag: TAG_PATTERN.test(row.keepTag) ? row.keepTag : DEFAULT_LIBRARY_CLEANUP_SETTINGS.keepTag,
    countdownDays: row.countdownDays,
    notifyOnMark: row.notifyOnMark,
    importListExclusion: row.importListExclusion,
    movieRule: storedRule(row.movieRule),
    seriesRule: storedRule(row.seriesRule),
  };
}

export function libraryCleanupConfigData(settings: LibraryCleanupSettings) {
  return {
    keepTag: settings.keepTag,
    countdownDays: settings.countdownDays,
    notifyOnMark: settings.notifyOnMark,
    importListExclusion: settings.importListExclusion,
    movieRule: settings.movieRule as unknown as Prisma.InputJsonValue,
    seriesRule: settings.seriesRule as unknown as Prisma.InputJsonValue,
  };
}

export async function saveLibraryCleanupSettings(
  settings: LibraryCleanupSettings,
  db: Pick<Prisma.TransactionClient, 'libraryCleanupConfig'> = prisma,
): Promise<void> {
  const data = libraryCleanupConfigData(settings);
  await db.libraryCleanupConfig.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...data },
    update: data,
  });
}

export function ruleFor(settings: LibraryCleanupSettings, mediaType: LibraryMediaType): LibraryRule {
  return mediaType === 'movie' ? settings.movieRule : settings.seriesRule;
}
