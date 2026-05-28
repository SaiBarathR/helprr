import type {
  TmdbTitleWatchProvidersResponse,
  TmdbWatchProviderEntry,
} from '@/lib/tmdb-client';
import type {
  DiscoverWatchProviderEntry,
  DiscoverWatchProviders,
} from '@/types';

const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/w92';
const FALLBACK_REGION = 'US';

function mapEntries(
  list: TmdbWatchProviderEntry[] | undefined,
): DiscoverWatchProviderEntry[] | undefined {
  if (!list?.length) return undefined;
  return list
    .slice()
    .sort((a, b) => (a.display_priority ?? 0) - (b.display_priority ?? 0))
    .map((p) => ({
      logoPath: `${TMDB_LOGO_BASE}${p.logo_path}`,
      providerId: p.provider_id,
      providerName: p.provider_name,
    }));
}

function hasAnyEntries(
  region: TmdbTitleWatchProvidersResponse['results'][string] | undefined,
): boolean {
  if (!region) return false;
  return Boolean(
    region.flatrate?.length || region.rent?.length || region.buy?.length,
  );
}

function normalizeRegion(code: string | null | undefined): string {
  if (!code) return FALLBACK_REGION;
  const trimmed = code.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(trimmed) ? trimmed : FALLBACK_REGION;
}

/**
 * Resolve TMDB watch-providers data for a configured region.
 *
 * Tries the requested region first; if that region has no providers and is not
 * already the fallback (US), falls back to US so users still see something.
 * The returned `region` reflects what's actually being shown — UI can compare
 * against `requestedRegion` to surface a "showing X — Y unavailable" note.
 */
export function resolveTitleWatchProviders(
  data: TmdbTitleWatchProvidersResponse | null | undefined,
  requestedRegion: string | null | undefined,
): DiscoverWatchProviders | null {
  if (!data?.results) return null;

  const requested = normalizeRegion(requestedRegion);
  const requestedEntry = data.results[requested];

  let regionUsed = requested;
  let entry = requestedEntry;

  if (!hasAnyEntries(entry) && requested !== FALLBACK_REGION) {
    const fallbackEntry = data.results[FALLBACK_REGION];
    if (hasAnyEntries(fallbackEntry)) {
      regionUsed = FALLBACK_REGION;
      entry = fallbackEntry;
    }
  }

  if (!hasAnyEntries(entry)) return null;

  return {
    region: regionUsed,
    requestedRegion: requested,
    link: entry?.link,
    flatrate: mapEntries(entry?.flatrate),
    rent: mapEntries(entry?.rent),
    buy: mapEntries(entry?.buy),
  };
}
