export const SEERR_REQUEST_STATUS = {
  PENDING_APPROVAL: 1,
  APPROVED: 2,
  DECLINED: 3,
  FAILED: 4,
  COMPLETED: 5,
} as const;

export const SEERR_MEDIA_STATUS = {
  UNKNOWN: 1,
  PENDING: 2,
  PROCESSING: 3,
  PARTIALLY_AVAILABLE: 4,
  AVAILABLE: 5,
  DELETED: 6,
} as const;

export type SeerrRequestStatus = (typeof SEERR_REQUEST_STATUS)[keyof typeof SEERR_REQUEST_STATUS];
export type SeerrMediaStatus = (typeof SEERR_MEDIA_STATUS)[keyof typeof SEERR_MEDIA_STATUS];

export type SeerrMediaType = 'movie' | 'tv';

export type SeerrRequestFilter =
  | 'all'
  | 'approved'
  | 'pending'
  | 'available'
  | 'processing'
  | 'unavailable'
  | 'failed';

export type SeerrRequestSort = 'added' | 'modified';
export type SeerrSortDirection = 'asc' | 'desc';

export interface SeerrPageInfo {
  page: number;
  pages: number;
  pageSize: number;
  results: number;
}

export interface SeerrPaginated<T> {
  pageInfo: SeerrPageInfo;
  results: T[];
}

export interface SeerrUserSummary {
  id: number;
  email?: string;
  username?: string | null;
  plexUsername?: string | null;
  jellyfinUsername?: string | null;
  displayName?: string;
  avatar?: string;
  requestCount?: number;
  movieQuotaLimit?: number | null;
  movieQuotaDays?: number | null;
  tvQuotaLimit?: number | null;
  tvQuotaDays?: number | null;
  permissions?: number;
  userType?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SeerrMediaInfo {
  id: number;
  mediaType: SeerrMediaType;
  tmdbId: number;
  tvdbId?: number | null;
  imdbId?: string | null;
  status: SeerrMediaStatus;
  status4k?: SeerrMediaStatus;
  createdAt?: string;
  updatedAt?: string;
  lastSeasonChange?: string;
  jellyfinMediaId?: string | null;
  jellyfinMediaId4k?: string | null;
  mediaUrl?: string | null;
  serviceUrl?: string | null;
  externalServiceId?: number | null;
  externalServiceSlug?: string | null;
}

export interface SeerrSeasonRequest {
  id: number;
  seasonNumber: number;
  status: SeerrRequestStatus;
}

export interface SeerrRequest {
  id: number;
  status: SeerrRequestStatus;
  createdAt: string;
  updatedAt: string;
  type: SeerrMediaType;
  is4k: boolean;
  serverId?: number | null;
  profileId?: number | null;
  rootFolder?: string | null;
  languageProfileId?: number | null;
  tags?: number[];
  media: SeerrMediaInfo;
  seasons?: SeerrSeasonRequest[];
  modifiedBy?: SeerrUserSummary | null;
  requestedBy: SeerrUserSummary;
  seasonCount?: number;
}

export interface SeerrRequestCount {
  total: number;
  movie: number;
  tv: number;
  pending: number;
  approved: number;
  declined: number;
  processing: number;
  available: number;
}

export interface SeerrQuotaStatus {
  days: number;
  limit: number;
  used: number;
  remaining: number;
  restricted: boolean;
}

export interface SeerrUserQuota {
  movie: SeerrQuotaStatus;
  tv: SeerrQuotaStatus;
}

export interface SeerrStatus {
  version: string;
  commitTag?: string;
  updateAvailable?: boolean;
  commitsBehind?: number;
}

export interface SeerrMediaDetail {
  id: number;
  title?: string;
  name?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseDate?: string;
  firstAirDate?: string;
  overview?: string;
  voteAverage?: number;
}

// ── Service data (Radarr/Sonarr) for request/approve overrides ──
export interface SeerrQualityProfile {
  id: number;
  name: string;
}

export interface SeerrRootFolder {
  id: number;
  path: string;
  freeSpace?: number;
}

export interface SeerrTag {
  id: number;
  label: string;
}

/** Resolved service options for the default server, surfaced to the request modal. */
export interface SeerrServiceData {
  serverId: number | null;
  profiles: SeerrQualityProfile[];
  rootFolders: SeerrRootFolder[];
  tags: SeerrTag[];
  defaultProfileId: number | null;
  defaultRootFolder: string | null;
  defaultTags: number[];
}

// ── TV season info for the season-selection table ──
export interface SeerrSeasonInfo {
  seasonNumber: number;
  episodeCount: number;
  name?: string;
  /** Current Seerr media status for the season (PENDING/AVAILABLE/…), or null. */
  status: SeerrMediaStatus | null;
}

export interface EnrichedSeerrRequest extends SeerrRequest {
  enriched: {
    title: string | null;
    year: number | null;
    posterUrl: string | null;
    helprr: { type: 'movie' | 'series'; id: number } | null;
  };
}
