import { parseItemKey, type RecMediaType } from './item-keys';
import {
  emptyTasteProfile,
  type Daypart,
  type GenreVector,
  type MediaClassProfile,
  type ProfileSeed,
  type TasteProfile,
} from './profile-types';

// Pure profile builder: pre-collected signals in, TasteProfile out. No I/O, no
// clock reads (`now` is injected) — fully unit-testable and deterministic.
//
// Weighting model (all mass is time-decayed exponentially):
//   engagement(title) = (plays + completion + favorite + rating + watch-time) × recency
// Genre/decade vectors accumulate that mass per attribute and are normalized so
// the strongest entry is 1 — scoring then compares candidates against a stable
// 0..1 scale regardless of how much history a user has.

/** One engaged title from Jellyfin (matched arr item) or AniList (anime). */
export interface EngagedTitleSignal {
  itemKey: string;
  mediaType: RecMediaType;
  tmdbId?: number;
  anilistId?: number;
  title: string;
  genres: string[];
  year: number | null;
  runtimeMin: number | null;
  playCount: number;
  /** ISO timestamp of the most recent play, null when unknown. */
  lastPlayedAt: string | null;
  fullyWatched: boolean;
  favorite: boolean;
  /** Explicit rating normalized to 0..1 (AniList score), null when unrated. */
  ratingNorm: number | null;
  /** Minutes actually watched (Playback Reporting), when matched. */
  watchTimeMin?: number;
}

/** One play occurrence with a timestamp — drives the mood/daypart model. */
export interface PlaySignal {
  at: string;
  genres: string[];
}

export interface EventSignalItem {
  itemKey: string;
  /** Genres snapshotted into event context by the client (no lookup at build time). */
  genres?: string[];
  at: string;
}

export interface EventSignals {
  /** like / click / play / watchlist_add / request events. */
  positives: EventSignalItem[];
  /** dislike / not_interested events (dislikes still decay; excludes don't). */
  negatives: EventSignalItem[];
  /** All-time hard-exclude keys (not_interested + dislike), never decayed. */
  excludedItemKeys: string[];
  /** Liked item keys (all-time) — boosted and usable as seeds later. */
  likedItemKeys: string[];
  /** Impressions that never converted to a click, for fatigue. */
  impressionsWithoutClick: EventSignalItem[];
}

export interface WatchlistSignal {
  itemKey: string;
  genres: string[];
  addedAt: string;
}

export interface BuildProfileInput {
  now: Date;
  engagedTitles: EngagedTitleSignal[];
  plays: PlaySignal[];
  playsFromPlaybackReporting: boolean;
  events: EventSignals;
  watchlist: WatchlistSignal[];
  /** AniList media ids on the user's list (any status). */
  listedAnilistIds?: number[];
  sources: TasteProfile['sources'];
}

const PLAY_HALF_LIFE_DAYS = 45;
const EVENT_HALF_LIFE_DAYS = 21;
const IMPRESSION_HALF_LIFE_DAYS = 14;
const WATCHLIST_HALF_LIFE_DAYS = 90;
/** Recency multiplier for engagement with no known last-play date. */
const UNKNOWN_RECENCY = 0.3;
const MAX_SEEDS = 8;
const MAX_GENRES_PER_VECTOR = 30;
const MAX_WATCHED_KEYS = 2000;
const MAX_FATIGUE_KEYS = 500;

function decay(at: string | null, now: Date, halfLifeDays: number): number {
  if (!at) return UNKNOWN_RECENCY;
  const ts = Date.parse(at);
  if (!Number.isFinite(ts)) return UNKNOWN_RECENCY;
  const ageDays = Math.max(0, (now.getTime() - ts) / 86_400_000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export function normalizeGenre(genre: string): string {
  return genre.trim().toLowerCase();
}

function addGenres(vector: GenreVector, genres: string[], weight: number): void {
  if (weight <= 0) return;
  for (const raw of genres) {
    const g = normalizeGenre(raw);
    if (!g) continue;
    vector[g] = (vector[g] ?? 0) + weight;
  }
}

/** Scale a vector so its max entry is 1 and keep only the strongest genres. */
function normalizeVector(vector: GenreVector, maxEntries = MAX_GENRES_PER_VECTOR): GenreVector {
  const entries = Object.entries(vector).filter(([, w]) => w > 0);
  if (entries.length === 0) return {};
  const max = Math.max(...entries.map(([, w]) => w));
  return Object.fromEntries(
    entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxEntries)
      .map(([g, w]) => [g, Number((w / max).toFixed(4))])
  );
}

function decadeOf(year: number | null): string | null {
  if (!year || year < 1900 || year > 2100) return null;
  return String(Math.floor(year / 10) * 10);
}

/** Media class for a signal that only carries an item key (watchlist rows,
 * event context). parseItemKey handles every key form incl. arr:sonarr → tv. */
function mediaTypeOfKey(itemKey: string): RecMediaType {
  return parseItemKey(itemKey)?.mediaType ?? 'movie';
}

/**
 * Engagement mass for one title, before recency. Roughly bounded to ~8 so a
 * single obsessively rewatched title can't drown the rest of the profile.
 */
export function engagementWeight(t: EngagedTitleSignal): number {
  let w = Math.min(3, Math.log2(1 + Math.max(0, t.playCount)));
  if (t.fullyWatched) w += 1;
  if (t.favorite) w += 1.5;
  if (t.ratingNorm != null) w += (t.ratingNorm - 0.5) * 3; // 0..1 rating → -1.5..+1.5
  if (t.watchTimeMin != null) w += Math.min(2, t.watchTimeMin / 240);
  return w;
}

export function daypartOf(hour: number): Daypart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 23) return 'evening';
  return 'night';
}

interface ClassAccumulator {
  genres: GenreVector;
  decades: GenreVector;
  runtimeWeighted: number;
  runtimeMass: number;
  signalMass: number;
}

function newClassAccumulator(): ClassAccumulator {
  return { genres: {}, decades: {}, runtimeWeighted: 0, runtimeMass: 0, signalMass: 0 };
}

function finishClass(acc: ClassAccumulator): MediaClassProfile {
  return {
    genres: normalizeVector(acc.genres),
    decades: normalizeVector(acc.decades, 12),
    typicalRuntimeMin: acc.runtimeMass > 0 ? Math.round(acc.runtimeWeighted / acc.runtimeMass) : null,
    signalMass: Number(acc.signalMass.toFixed(3)),
  };
}

export function buildTasteProfile(input: BuildProfileInput): TasteProfile {
  const { now } = input;
  const profile = emptyTasteProfile(now.toISOString());
  profile.sources = { ...input.sources };

  const classes: Record<RecMediaType, ClassAccumulator> = {
    movie: newClassAccumulator(),
    tv: newClassAccumulator(),
    anime: newClassAccumulator(),
  };

  // ── Engagement (Jellyfin + AniList) ────────────────────────────────────────
  const seedCandidates: Array<ProfileSeed & { rawWeight: number }> = [];
  const watchedKeys: string[] = [];

  for (const title of input.engagedTitles) {
    const recency = decay(title.lastPlayedAt, now, PLAY_HALF_LIFE_DAYS);
    const weight = Math.max(0, engagementWeight(title)) * recency;
    if (title.fullyWatched) watchedKeys.push(title.itemKey);
    if (weight <= 0) continue;

    const acc = classes[title.mediaType];
    acc.signalMass += weight;
    addGenres(acc.genres, title.genres, weight);
    const decade = decadeOf(title.year);
    if (decade) acc.decades[decade] = (acc.decades[decade] ?? 0) + weight;
    if (title.runtimeMin && title.runtimeMin > 0) {
      acc.runtimeWeighted += title.runtimeMin * weight;
      acc.runtimeMass += weight;
    }

    seedCandidates.push({
      itemKey: title.itemKey,
      mediaType: title.mediaType,
      tmdbId: title.tmdbId,
      anilistId: title.anilistId,
      title: title.title,
      weight: 0, // normalized below
      rawWeight: weight,
    });
  }

  // ── Watchlist intent (mild) ────────────────────────────────────────────────
  for (const item of input.watchlist) {
    const weight = 0.5 * decay(item.addedAt, now, WATCHLIST_HALF_LIFE_DAYS);
    const parsedType = mediaTypeOfKey(item.itemKey);
    addGenres(classes[parsedType].genres, item.genres, weight);
    classes[parsedType].signalMass += weight;
  }

  // ── In-app feedback events ─────────────────────────────────────────────────
  for (const ev of input.events.positives) {
    if (!ev.genres?.length) continue;
    const weight = 0.8 * decay(ev.at, now, EVENT_HALF_LIFE_DAYS);
    addGenres(classes[mediaTypeOfKey(ev.itemKey)].genres, ev.genres, weight);
  }

  const dislikedGenres: GenreVector = {};
  for (const ev of input.events.negatives) {
    if (!ev.genres?.length) continue;
    addGenres(dislikedGenres, ev.genres, decay(ev.at, now, EVENT_HALF_LIFE_DAYS));
  }

  const fatigue: Record<string, number> = {};
  for (const imp of input.events.impressionsWithoutClick) {
    const weight = decay(imp.at, now, IMPRESSION_HALF_LIFE_DAYS);
    if (weight < 0.05) continue;
    fatigue[imp.itemKey] = (fatigue[imp.itemKey] ?? 0) + weight;
  }

  // ── Moods (daypart × genre) ────────────────────────────────────────────────
  const daypartMass: Record<Daypart, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  const genresByDaypart: Partial<Record<Daypart, GenreVector>> = {};
  for (const play of input.plays) {
    const ts = Date.parse(play.at);
    if (!Number.isFinite(ts)) continue;
    const weight = decay(play.at, now, PLAY_HALF_LIFE_DAYS);
    const daypart = daypartOf(new Date(ts).getHours());
    daypartMass[daypart] += weight;
    if (play.genres.length) {
      const vector = (genresByDaypart[daypart] ??= {});
      addGenres(vector, play.genres, weight);
    }
  }
  const totalDaypartMass = Object.values(daypartMass).reduce((a, b) => a + b, 0);
  if (totalDaypartMass > 0) {
    for (const key of Object.keys(daypartMass) as Daypart[]) {
      profile.moods.dayparts[key] = Number((daypartMass[key] / totalDaypartMass).toFixed(4));
    }
  }
  for (const [daypart, vector] of Object.entries(genresByDaypart) as Array<[Daypart, GenreVector]>) {
    profile.moods.genresByDaypart[daypart] = normalizeVector(vector, 15);
  }
  profile.moods.fromPlaybackReporting = input.playsFromPlaybackReporting;

  // ── Assemble ───────────────────────────────────────────────────────────────
  profile.movie = finishClass(classes.movie);
  profile.tv = finishClass(classes.tv);
  profile.anime = finishClass(classes.anime);

  const excluded = new Set(input.events.excludedItemKeys);
  seedCandidates.sort((a, b) => b.rawWeight - a.rawWeight);
  const maxSeedWeight = seedCandidates[0]?.rawWeight ?? 0;
  profile.seeds = seedCandidates
    .filter((s) => !excluded.has(s.itemKey))
    .slice(0, MAX_SEEDS)
    .map(({ rawWeight, ...seed }) => ({
      ...seed,
      weight: maxSeedWeight > 0 ? Number((rawWeight / maxSeedWeight).toFixed(4)) : 0,
    }));

  profile.negatives = {
    excludedItemKeys: [...excluded],
    dislikedGenres: normalizeVector(dislikedGenres, 15),
  };
  profile.fatigue.seenWithoutClick = Object.fromEntries(
    Object.entries(fatigue)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_FATIGUE_KEYS)
      .map(([k, v]) => [k, Number(v.toFixed(3))])
  );
  profile.watchedItemKeys = watchedKeys.slice(0, MAX_WATCHED_KEYS);
  profile.likedItemKeys = [...new Set(input.events.likedItemKeys)];
  profile.listedAnilistIds = [...new Set(input.listedAnilistIds ?? [])];

  return profile;
}
