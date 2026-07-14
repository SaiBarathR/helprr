// Local Helprr sessions use a fixed-lifetime JWT. Database rows older than
// this duration cannot authenticate even if they were recently active.
export const SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60;
