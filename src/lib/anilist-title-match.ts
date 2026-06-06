/**
 * Pure title-matching helpers shared by the server-side AniList mapping
 * resolver and the client-side remap drawer. Season-split anime follow a
 * reliable naming pattern — "{base} Season {N}" (also "2nd Season", "Part N",
 * roman numerals, "Final Season") — which these helpers normalize, detect,
 * and compare. No prisma / server-only imports.
 */

const WORD_ORDINALS = 'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth';

const WORD_ORDINAL_VALUES: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

const ROMAN_NUMERAL_VALUES: Record<string, number> = {
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
};

/** "Final Season" parses into a high season band so it sorts after numbered seasons. */
const FINAL_SEASON_BAND = 99;

export function normalizeTitle(value: string | null | undefined): string {
  if (!value) return '';

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3000-\u9fff\uff00-\uffef]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Normalized title with season/part/cour markers removed, so "Attack on Titan
 * Season 2" and "Attack on Titan The Final Season" both reduce to "attack on
 * titan". Every stripped phrase requires an explicit marker word — bare
 * "final"/"first" in legit titles (e.g. "Final Approach") are untouched.
 */
export function normalizeBaseTitle(value: string | null | undefined): string {
  return normalizeTitle(value)
    .replace(/\b(?:season|part|cour)\s+\d+\b/g, '')
    .replace(/\b(?:\d+)(?:st|nd|rd|th)\s+season\b/g, '')
    .replace(new RegExp(`\\b(?:${WORD_ORDINALS})\\s+season\\b`, 'g'), '')
    .replace(/\b(?:the\s+)?final\s+season\b/g, '')
    .replace(/\b(?:ii|iii|iv|v|vi|vii|viii|ix|x)\b/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

const SEASON_MARKER_PATTERNS: RegExp[] = [
  /\b(?:season|part|cour)\s+\d+\b/,
  /\b\d+(?:st|nd|rd|th)\s+season\b/,
  new RegExp(`\\b(?:${WORD_ORDINALS})\\s+season\\b`),
  /\b(?:the\s+)?final\s+season\b/,
  /\b(?:ii|iii|iv|v|vi|vii|viii|ix|x)\b/,
];

/** True when the title carries an explicit season marker ("… Season 2", "2nd Season", "Part 3", "Final Season", roman numerals). */
export function hasSeasonMarker(value: string | null | undefined): boolean {
  const normalized = normalizeTitle(value);
  if (!normalized) return false;
  return SEASON_MARKER_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Sortable key for season entries: season * 100 + part, so "Season 3 Part 2"
 * lands after Part 1 and before Season 4, and "Final Season (Part N)" sorts
 * last. A bare "Part N" with no season token counts as season 1. Unparseable
 * titles → Infinity (callers tiebreak by seasonYear).
 */
export function seasonSortKey(value: string | null | undefined): number {
  const normalized = normalizeTitle(value);
  if (!normalized) return Infinity;

  let season: number | null = null;

  const arabic = normalized.match(/\bseason\s+(\d+)\b/) ?? normalized.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/);
  if (arabic) season = Number.parseInt(arabic[1], 10);

  if (season === null) {
    const word = normalized.match(new RegExp(`\\b(${WORD_ORDINALS})\\s+season\\b`));
    if (word) season = WORD_ORDINAL_VALUES[word[1]] ?? null;
  }

  if (season === null && /\b(?:the\s+)?final\s+season\b/.test(normalized)) {
    season = FINAL_SEASON_BAND;
  }

  if (season === null) {
    const roman = normalized.match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b/);
    if (roman) season = ROMAN_NUMERAL_VALUES[roman[1]] ?? null;
  }

  const partMatch = normalized.match(/\b(?:part|cour)\s+(\d+)\b/);
  const part = partMatch ? Number.parseInt(partMatch[1], 10) : 0;

  if (season === null) {
    return partMatch ? 100 + part : Infinity;
  }
  return season * 100 + part;
}

export interface SeasonSiblingInput {
  /** Title variants (english / romaji / native); null entries are skipped. */
  titles: Array<string | null | undefined>;
  /** Season year (or start year) when known — guards the bare-root clause. */
  year?: number | null;
}

/**
 * True when `candidate` looks like another season of `primary`: some non-empty
 * candidate base title EXACTLY equals a primary base title (exact equality,
 * never prefix/contains — keeps spin-offs like "Code Geass: Akito the Exiled"
 * out) AND the candidate carries a season marker. The bare-root clause also
 * accepts a marker-less candidate whose full title IS the shared base when the
 * primary itself is a marked season (primary "X Season 2" links the root "X"),
 * provided the root did not air after the marked season.
 */
export function isSeasonSibling(primary: SeasonSiblingInput, candidate: SeasonSiblingInput): boolean {
  const primaryBases = new Set(primary.titles.map(normalizeBaseTitle).filter(Boolean));
  if (primaryBases.size === 0) return false;

  const baseMatches = candidate.titles.some((title) => {
    const base = normalizeBaseTitle(title);
    return Boolean(base) && primaryBases.has(base);
  });
  if (!baseMatches) return false;

  if (candidate.titles.some((title) => hasSeasonMarker(title))) return true;

  if (!primary.titles.some((title) => hasSeasonMarker(title))) return false;
  const isBareRoot = candidate.titles.some((title) => {
    const normalized = normalizeTitle(title);
    return Boolean(normalized) && primaryBases.has(normalized);
  });
  if (!isBareRoot) return false;
  if (primary.year != null && candidate.year != null && candidate.year > primary.year) return false;
  return true;
}
