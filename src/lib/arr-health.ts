// Sonarr, Radarr and Lidarr health checks (System → Status) as Helprr shows
// them: in Settings → Service status and in the health pushes.
import { redactUpstreamText } from '@/lib/manual-downloads/redact';
import { urlsToOrigins } from '@/lib/url-origins';
import type { HealthCheck } from '@/types/arr';

/**
 * A health message as shown to users. It names hosts and paths (which is why
 * only admins and notify.health may read it), and a proxy or indexer failure
 * can quote a URL with a key in it, so URLs are cut to their origin and the
 * usual credential redaction runs, as for Prowlarr's.
 */
export function redactHealthMessage(message: unknown): string {
  return redactUpstreamText(urlsToOrigins(String(message ?? '')));
}

/** Rebuilt from the four fields the view shows; only https help links are passed on. */
export function toHealthChecks(raw: unknown): HealthCheck[] {
  return (Array.isArray(raw) ? raw : []).map((check: Partial<Record<keyof HealthCheck, unknown>>) => ({
    source: String(check?.source ?? ''),
    type: String(check?.type ?? ''),
    message: redactHealthMessage(check?.message),
    wikiUrl: typeof check?.wikiUrl === 'string' && check.wikiUrl.startsWith('https://') ? check.wikiUrl : '',
  }));
}
