// Reference data (quality profiles, tags, root folders, metadata profiles)
// changes rarely, so it gets a longer browser cache than the hot-read endpoints
// (which use 120/60/30s). `private` + `Vary: Cookie` is mandatory — these routes
// are auth-gated, so a response must never be replayed to another session.
// Complements the client TanStack cache; the HTTP cache backstops reloads.
export const REFERENCE_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=300, stale-while-revalidate=600',
  'Vary': 'Cookie',
} as const;
