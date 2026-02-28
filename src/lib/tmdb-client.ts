import axios, { AxiosInstance } from 'axios';

export type TmdbMediaType = 'movie' | 'tv';

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbCompany {
  id: number;
  logo_path: string | null;
  name: string;
  origin_country: string;
}

export interface TmdbNetwork {
  id: number;
  logo_path: string | null;
  name: string;
  origin_country: string;
}

export interface TmdbListItem {
  id: number;
  media_type?: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  adult?: boolean;
  original_language?: string;
  origin_country?: string[];
}

export interface TmdbMovieDetail {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  runtime: number | null;
  status: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  genres: TmdbGenre[];
  production_companies: TmdbCompany[];
  production_countries: { iso_3166_1: string; name: string }[];
  spoken_languages: { english_name: string; iso_639_1: string; name: string }[];
  original_language: string;
  imdb_id?: string | null;
}

export interface TmdbTvDetail {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  episode_run_time: number[];
  status: string;
  popularity: number;
  vote_average: number;
  vote_count: number;
  genres: TmdbGenre[];
  networks: TmdbNetwork[];
  production_companies: TmdbCompany[];
  production_countries: { iso_3166_1: string; name: string }[];
  spoken_languages: string[];
  original_language: string;
  origin_country: string[];
}

interface TmdbListResponse {
  page: number;
  total_pages: number;
  total_results: number;
  results: TmdbListItem[];
}

interface TmdbGenresResponse {
  genres: TmdbGenre[];
}

interface TmdbProvidersResponse {
  results: Array<{
    display_priority: number;
    logo_path: string | null;
    provider_id: number;
    provider_name: string;
  }>;
}

interface TmdbExternalIdsResponse {
  imdb_id?: string | null;
  tvdb_id?: number | null;
}

export interface TmdbDiscoverParams {
  page?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  query?: string;
  includeAdult?: boolean;
  genres?: number[];
  yearFrom?: number;
  yearTo?: number;
  runtimeMin?: number;
  runtimeMax?: number;
  language?: string;
  region?: string;
  ratingMin?: number;
  ratingMax?: number;
  voteCountMin?: number;
  providers?: number[];
  networks?: number[];
  releaseState?: 'released' | 'upcoming' | 'airing' | 'ended';
  anime?: boolean;
}

export class TmdbRateLimitError extends Error {
  retryAfterSeconds: number | null;
  retryAt: string | null;

  constructor(message: string, retryAfterSeconds: number | null, retryAt: string | null) {
    super(message);
    this.name = 'TmdbRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
    this.retryAt = retryAt;
  }
}

const tmdbCooldowns = new Map<string, number>();
const TMDB_REQUEST_TIMEOUT_MS = 10000;
const TMDB_COOLDOWN_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const TMDB_COOLDOWN_MAX_KEYS = 64;
let tmdbLastSweepAtMs = 0;

function sweepTmdbCooldowns(nowMs: number): void {
  if (tmdbCooldowns.size === 0) {
    tmdbLastSweepAtMs = nowMs;
    return;
  }

  for (const [apiKey, cooldownUntil] of tmdbCooldowns.entries()) {
    if (cooldownUntil <= nowMs) {
      tmdbCooldowns.delete(apiKey);
    }
  }

  if (tmdbCooldowns.size > TMDB_COOLDOWN_MAX_KEYS) {
    const sortedByCooldown = [...tmdbCooldowns.entries()].sort((a, b) => a[1] - b[1]);
    const keysToRemove = tmdbCooldowns.size - TMDB_COOLDOWN_MAX_KEYS;
    for (let i = 0; i < keysToRemove; i += 1) {
      const key = sortedByCooldown[i]?.[0];
      if (key) {
        tmdbCooldowns.delete(key);
      }
    }
  }

  tmdbLastSweepAtMs = nowMs;
}

function maybeSweepTmdbCooldowns(nowMs: number): void {
  const shouldSweepByTime = nowMs - tmdbLastSweepAtMs >= TMDB_COOLDOWN_SWEEP_INTERVAL_MS;
  const shouldSweepBySize = tmdbCooldowns.size > TMDB_COOLDOWN_MAX_KEYS;
  if (shouldSweepByTime || shouldSweepBySize) {
    sweepTmdbCooldowns(nowMs);
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function getHeader(headers: unknown, key: string): string | null {
  const record = toRecord(headers);
  const direct = record[key];
  if (typeof direct === 'string' && direct) return direct;

  const lower = key.toLowerCase();
  const lowerValue = record[lower];
  if (typeof lowerValue === 'string' && lowerValue) return lowerValue;

  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === lower && typeof v === 'string' && v) {
      return v;
    }
  }

  return null;
}

function parseRetryAfter(headers: unknown): { retryAfterSeconds: number | null; retryAt: string | null } {
  const retryAfterRaw = getHeader(headers, 'retry-after');
  if (retryAfterRaw) {
    const asSeconds = Number(retryAfterRaw);
    if (Number.isFinite(asSeconds) && asSeconds > 0) {
      const retryAtMs = Date.now() + asSeconds * 1000;
      return {
        retryAfterSeconds: Math.ceil(asSeconds),
        retryAt: new Date(retryAtMs).toISOString(),
      };
    }

    const asDateMs = Date.parse(retryAfterRaw);
    if (!Number.isNaN(asDateMs)) {
      const delta = Math.max(1, Math.ceil((asDateMs - Date.now()) / 1000));
      return {
        retryAfterSeconds: delta,
        retryAt: new Date(asDateMs).toISOString(),
      };
    }
  }

  const resetRaw = getHeader(headers, 'x-ratelimit-reset') || getHeader(headers, 'x-rate-limit-reset');
  if (resetRaw) {
    const asEpochSeconds = Number(resetRaw);
    if (Number.isFinite(asEpochSeconds) && asEpochSeconds > 0) {
      const resetMs = asEpochSeconds * 1000;
      const delta = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
      return {
        retryAfterSeconds: delta,
        retryAt: new Date(resetMs).toISOString(),
      };
    }
  }

  return { retryAfterSeconds: null, retryAt: null };
}

export class TmdbClient {
  private client: AxiosInstance;
  private apiKey: string;
  private useBearerAuth: boolean;

  constructor(url: string, apiKey: string) {
    this.apiKey = apiKey;
    this.useBearerAuth = apiKey.includes('.') || apiKey.startsWith('eyJ');
    this.client = axios.create({
      baseURL: url.replace(/\/+$/, ''),
      timeout: TMDB_REQUEST_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  private async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const nowMs = Date.now();
    maybeSweepTmdbCooldowns(nowMs);

    const cooldownUntil = tmdbCooldowns.get(this.apiKey);
    if (cooldownUntil && nowMs >= cooldownUntil) {
      tmdbCooldowns.delete(this.apiKey);
    }
    if (cooldownUntil && nowMs < cooldownUntil) {
      const remainingSeconds = Math.max(1, Math.ceil((cooldownUntil - nowMs) / 1000));
      throw new TmdbRateLimitError(
        'TMDB rate limit reached',
        remainingSeconds,
        new Date(cooldownUntil).toISOString()
      );
    }

    try {
      const response = await this.client.get<T>(endpoint, {
        params: {
          ...params,
          ...(this.useBearerAuth ? {} : { api_key: this.apiKey }),
        },
        headers: {
          ...(this.useBearerAuth ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        const parsed = parseRetryAfter(error.response.headers);
        const retryAfterSeconds = parsed.retryAfterSeconds ?? 60;
        const parsedRetryAtMs = parsed.retryAt ? Date.parse(parsed.retryAt) : Number.NaN;
        const retryAtMs = Number.isFinite(parsedRetryAtMs)
          ? parsedRetryAtMs
          : Date.now() + retryAfterSeconds * 1000;
        tmdbCooldowns.set(this.apiKey, retryAtMs);
        maybeSweepTmdbCooldowns(Date.now());
        throw new TmdbRateLimitError(
          'TMDB rate limit reached',
          retryAfterSeconds,
          parsed.retryAt || new Date(retryAtMs).toISOString()
        );
      }

      throw error;
    }
  }

  async validateConnection(): Promise<void> {
    await this.get('/configuration');
  }

  async trending(mediaType: 'all' | TmdbMediaType, page = 1): Promise<TmdbListResponse> {
    return this.get<TmdbListResponse>(`/trending/${mediaType}/day`, { page });
  }

  async searchMulti(query: string, page = 1): Promise<TmdbListResponse> {
    return this.get<TmdbListResponse>('/search/multi', { query, page, include_adult: false });
  }

  async searchMovie(query: string, page = 1): Promise<TmdbListResponse> {
    return this.get<TmdbListResponse>('/search/movie', { query, page, include_adult: false });
  }

  async searchTv(query: string, page = 1): Promise<TmdbListResponse> {
    return this.get<TmdbListResponse>('/search/tv', { query, page, include_adult: false });
  }

  async discoverMovie(input: TmdbDiscoverParams = {}): Promise<TmdbListResponse> {
    const params: Record<string, unknown> = {
      page: input.page ?? 1,
      include_adult: input.includeAdult ?? false,
      sort_by: this.formatSort(input.sortBy, input.sortOrder),
    };

    if (input.genres?.length) params.with_genres = input.genres.join(',');
    if (input.yearFrom) params['primary_release_date.gte'] = `${input.yearFrom}-01-01`;
    if (input.yearTo) params['primary_release_date.lte'] = `${input.yearTo}-12-31`;
    if (input.runtimeMin != null) params['with_runtime.gte'] = input.runtimeMin;
    if (input.runtimeMax != null) params['with_runtime.lte'] = input.runtimeMax;
    if (input.language) params.with_original_language = input.language;
    if (input.region) params.region = input.region;
    if (input.ratingMin != null) params['vote_average.gte'] = input.ratingMin;
    if (input.ratingMax != null) params['vote_average.lte'] = input.ratingMax;
    if (input.voteCountMin != null) params['vote_count.gte'] = input.voteCountMin;
    if (input.providers?.length) {
      params.with_watch_providers = input.providers.join('|');
      params.watch_region = input.region || 'US';
    }
    if (input.anime) {
      const existingGenres = typeof params.with_genres === 'string'
        ? params.with_genres
          .split(',')
          .map((genreId) => Number(genreId.trim()))
          .filter((genreId) => Number.isFinite(genreId))
        : [];
      const mergedGenres = [...new Set([16, ...existingGenres, ...(input.genres ?? [])])];
      params.with_genres = mergedGenres.join(',');
      if (!input.language) {
        params.with_original_language = 'ja';
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    if (input.releaseState === 'released') params['primary_release_date.lte'] = today;
    if (input.releaseState === 'upcoming') params['primary_release_date.gte'] = today;

    return this.get<TmdbListResponse>('/discover/movie', params);
  }

  async discoverTv(input: TmdbDiscoverParams = {}): Promise<TmdbListResponse> {
    const params: Record<string, unknown> = {
      page: input.page ?? 1,
      include_adult: input.includeAdult ?? false,
      sort_by: this.formatSort(input.sortBy, input.sortOrder),
    };

    if (input.genres?.length) params.with_genres = input.genres.join(',');
    if (input.yearFrom) params['first_air_date.gte'] = `${input.yearFrom}-01-01`;
    if (input.yearTo) params['first_air_date.lte'] = `${input.yearTo}-12-31`;
    if (input.runtimeMin != null) params['with_runtime.gte'] = input.runtimeMin;
    if (input.runtimeMax != null) params['with_runtime.lte'] = input.runtimeMax;
    if (input.language) params.with_original_language = input.language;
    if (input.ratingMin != null) params['vote_average.gte'] = input.ratingMin;
    if (input.ratingMax != null) params['vote_average.lte'] = input.ratingMax;
    if (input.voteCountMin != null) params['vote_count.gte'] = input.voteCountMin;
    if (input.providers?.length) {
      params.with_watch_providers = input.providers.join('|');
      params.watch_region = input.region || 'US';
    }
    if (input.networks?.length) params.with_networks = input.networks.join('|');

    if (input.releaseState === 'airing') params.with_status = '0';
    if (input.releaseState === 'ended') params.with_status = '3';
    if (input.releaseState === 'upcoming') params.with_status = '1|2|5';

    if (input.anime) {
      const existingGenres = typeof params.with_genres === 'string'
        ? params.with_genres
          .split(',')
          .map((genreId) => Number(genreId.trim()))
          .filter((genreId) => Number.isFinite(genreId))
        : [];
      const mergedGenres = [...new Set([16, ...existingGenres, ...(input.genres ?? [])])];
      params.with_genres = mergedGenres.join(',');
      params.with_origin_country = 'JP';
      if (!input.language) {
        params.with_original_language = 'ja';
      }
    }

    return this.get<TmdbListResponse>('/discover/tv', params);
  }

  async movieDetails(id: number): Promise<TmdbMovieDetail> {
    return this.get<TmdbMovieDetail>(`/movie/${id}`);
  }

  async tvDetails(id: number): Promise<TmdbTvDetail> {
    return this.get<TmdbTvDetail>(`/tv/${id}`);
  }

  async movieExternalIds(id: number): Promise<TmdbExternalIdsResponse> {
    return this.get<TmdbExternalIdsResponse>(`/movie/${id}/external_ids`);
  }

  async tvExternalIds(id: number): Promise<TmdbExternalIdsResponse> {
    return this.get<TmdbExternalIdsResponse>(`/tv/${id}/external_ids`);
  }

  async movieGenres(): Promise<TmdbGenre[]> {
    const data = await this.get<TmdbGenresResponse>('/genre/movie/list');
    return data.genres || [];
  }

  async tvGenres(): Promise<TmdbGenre[]> {
    const data = await this.get<TmdbGenresResponse>('/genre/tv/list');
    return data.genres || [];
  }

  async movieWatchProviders(region = 'US'): Promise<TmdbProvidersResponse['results']> {
    const data = await this.get<TmdbProvidersResponse>('/watch/providers/movie', {
      watch_region: region,
    });
    return data.results || [];
  }

  async tvWatchProviders(region = 'US'): Promise<TmdbProvidersResponse['results']> {
    const data = await this.get<TmdbProvidersResponse>('/watch/providers/tv', {
      watch_region: region,
    });
    return data.results || [];
  }

  private formatSort(sortBy?: string, sortOrder: 'asc' | 'desc' = 'desc'): string {
    if (!sortBy) return `popularity.${sortOrder}`;
    if (sortBy.includes('.')) return sortBy;

    const mapped: Record<string, string> = {
      popularity: 'popularity',
      rating: 'vote_average',
      voteCount: 'vote_count',
      releaseDate: 'primary_release_date',
      firstAirDate: 'first_air_date',
      title: 'title',
      name: 'name',
    };

    const key = mapped[sortBy] || sortBy;
    return `${key}.${sortOrder}`;
  }
}
