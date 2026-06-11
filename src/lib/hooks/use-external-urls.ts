import { useEffect, useState } from 'react';

type ExternalUrlRow = { id: string; type: string; externalUrl: string | null };

interface ExternalUrlMaps {
  byType: Record<string, string>; // default-instance external URL per type
  byInstance: Record<string, string>; // connection id → external URL
}

const EMPTY: ExternalUrlMaps = { byType: {}, byInstance: {} };

let cached: ExternalUrlMaps | null = null;
let pending: Promise<ExternalUrlMaps> | null = null;

export function invalidateExternalUrls(): void {
  cached = null;
  pending = null;
}

function isEmpty(value: ExternalUrlMaps | null): boolean {
  return !value || Object.keys(value.byType).length === 0;
}

function fetchExternalUrls(): Promise<ExternalUrlMaps> {
  if (!pending) {
    pending = fetch('/api/services/external-urls')
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: ExternalUrlRow[]) => {
        // The endpoint returns one row per connection (default instance first per
        // type). byType keeps the default instance's URL (back-compat); byInstance
        // keys every connection so a non-default item can deep-link to its own arr.
        const byType: Record<string, string> = {};
        const byInstance: Record<string, string> = {};
        if (Array.isArray(rows)) {
          for (const row of rows) {
            if (!row.externalUrl) continue;
            if (!byType[row.type]) byType[row.type] = row.externalUrl;
            byInstance[row.id] = row.externalUrl;
          }
        }
        cached = { byType, byInstance };
        return cached;
      })
      .catch(() => EMPTY)
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

function useExternalUrlMaps(): ExternalUrlMaps {
  const [maps, setMaps] = useState<ExternalUrlMaps>(() => cached ?? EMPTY);

  useEffect(() => {
    if (!isEmpty(cached)) return;
    void fetchExternalUrls().then(setMaps);
  }, []);

  return maps;
}

/** Type → default-instance external URL. Back-compat shape; correct for
 * single-instance types (Jellyfin, Prowlarr) and as a fallback for arr links. */
export function useExternalUrls(): Record<string, string> {
  return useExternalUrlMaps().byType;
}

/**
 * Resolver that prefers a specific instance's external URL and falls back to the
 * type's default-instance URL. Use for Sonarr/Radarr/Lidarr deep links on
 * instance-aware pages so "Open in {arr}" opens the correct server.
 */
export function useExternalUrlResolver(): (type: string, instanceId?: string) => string | undefined {
  const maps = useExternalUrlMaps();
  return (type, instanceId) => (instanceId ? maps.byInstance[instanceId] : undefined) ?? maps.byType[type];
}
