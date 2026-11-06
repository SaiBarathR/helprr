// Local Helprr sessions use a fixed-lifetime JWT. Database rows older than
// this duration cannot authenticate even if they were recently active.
export const SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60;

// A session nobody has used for this long is refused and revoked, even inside
// its fixed lifetime. lastSeenAt is written at most every few minutes (see
// auth.ts), so it lags real activity by that much at most.
export const SESSION_IDLE_TIMEOUT_SECONDS = 14 * 24 * 60 * 60;
