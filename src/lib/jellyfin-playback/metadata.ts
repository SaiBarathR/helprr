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
