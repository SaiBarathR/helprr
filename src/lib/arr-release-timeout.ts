// Interactive search (`GET /release`) and grab (`POST /release`) wait on every
// indexer. Servarr caps each indexer HTTP call at 100s and may paginate; their
// Apache reverse-proxy sample uses 300s. Apply this only to those two calls —
// ordinary Arr library/queue/health requests stay at the 30s client default.
export const ARR_RELEASE_TIMEOUT_MS = 300_000;
