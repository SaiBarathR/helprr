/**
 * Display normalisation for Jellyfin item metadata.
 *
 * Both values arrive in whatever shape the metadata provider wrote, so neither
 * is safe to render directly.
 */

/**
 * Servers store `CommunityRating` on a 0–10 or a 0–100 scale depending on the
 * provider, so a blind `toFixed(1)` rendered "★ 84.0" for a title rated 8.4.
 */
export function formatCommunityRating(value?: number): string | null {
  if (!value || value <= 0) return null;
  return `★ ${(value > 10 ? value / 10 : value).toFixed(1)}`;
}

/**
 * `OfficialRating` arrives raw, e.g. "US:G / US:Rated G". Keep the first
 * variant and drop the region prefix so it reads as a certificate badge.
 */
export function formatCertificate(value?: string): string | null {
  if (!value) return null;
  const first = value.split('/')[0].trim();
  const withoutRegion = first.includes(':') ? first.slice(first.indexOf(':') + 1).trim() : first;
  return withoutRegion || null;
}

/** How long a title wears the "Recently added" ribbon. */
const RECENT_DAYS = 30;

/**
 * Whether a title is new enough for the site's red "Recently added" ribbon.
 *
 * Jellyfin's `DateCreated` is when the file landed on this server, which is
 * exactly the sense the ribbon carries — not the release date.
 */
export function isRecentlyAdded(dateCreated?: string, now = Date.now()): boolean {
  if (!dateCreated) return false;
  const added = new Date(dateCreated).getTime();
  if (Number.isNaN(added)) return false;
  const age = now - added;
  return age >= 0 && age <= RECENT_DAYS * 86_400_000;
}

/**
 * Runtime the way a streaming service writes it — "2h 1m", "46m" — rather than
 * the H:MM:SS clock the player uses. The site never shows seconds outside a
 * scrubber, and "1:28:30" reads as a timestamp rather than a duration.
 */
export function formatRuntimeShort(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
