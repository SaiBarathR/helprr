// Typed query-key factory. Shape: [domain, sub, ...discriminators]. instanceId
// is always present (normalized to 'default', mirroring the route caches'
// DEFAULT_INSTANCE) so two instances never collide, and the layout is
// prefix-invalidation friendly:
//   invalidateQueries({ queryKey: ['sonarr'] })            → all Sonarr queries
//   invalidateQueries({ queryKey: ['sonarr', 'library'] }) → just Sonarr lists
//   invalidateQueries({ queryKey: queryKeys.detail(...) }) → one item

export type ArrService = 'sonarr' | 'radarr' | 'lidarr';

const inst = (id?: string) => id ?? 'default';

export const queryKeys = {
  // ── Reference data (long staleTime) ──────────────────────────────
  qualityProfiles: (svc: ArrService, id?: string) => [svc, 'qualityprofiles', inst(id)] as const,
  tags: (svc: ArrService, id?: string) => [svc, 'tags', inst(id)] as const,
  rootFolders: (svc: ArrService, id?: string) => [svc, 'rootfolders', inst(id)] as const,
  metadataProfiles: (id?: string) => ['lidarr', 'metadataprofiles', inst(id)] as const,

  // ── Library lists ────────────────────────────────────────────────
  library: (svc: ArrService, o: { full?: boolean; instanceId?: string } = {}) =>
    [svc, 'library', o.full ? 'full' : 'slim', inst(o.instanceId)] as const,

  // ── Detail items ─────────────────────────────────────────────────
  detail: (svc: ArrService, itemId: number, id?: string) =>
    [svc, 'detail', inst(id), itemId] as const,
  episodes: (seriesId: number, id?: string) => ['sonarr', 'episodes', inst(id), seriesId] as const,
  credits: (svc: ArrService, itemId: number, id?: string) =>
    [svc, 'credits', inst(id), itemId] as const,
  anime: (seriesId: number, id?: string) => ['sonarr', 'anime', inst(id), seriesId] as const,

  // ── Activity / live ──────────────────────────────────────────────
  queue: (id?: string) => ['activity', 'queue', inst(id)] as const,
  history: (id?: string) => ['activity', 'history', inst(id)] as const,
  wanted: (id?: string) => ['activity', 'wanted', inst(id)] as const,
  recent: (id?: string) => ['activity', 'recent', inst(id)] as const,
  calendar: (range: string) => ['calendar', range] as const,
  health: () => ['services', 'health'] as const,
  libraryGaps: () => ['library-gaps'] as const,

  // ── Config / account ─────────────────────────────────────────────
  instances: (type?: string) => ['instances', type ?? 'all'] as const,
  settings: () => ['settings'] as const,
  notifications: () => ['notifications'] as const,
  sessions: () => ['sessions'] as const,
  users: () => ['users'] as const,

  // ── Discover / Seerr ─────────────────────────────────────────────
  discover: (kind: string, params?: Record<string, unknown>) =>
    params ? (['discover', kind, params] as const) : (['discover', kind] as const),
} as const;
