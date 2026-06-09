import { useEffect, useState } from 'react';

type ExternalUrls = Record<string, string>;
type ExternalUrlRow = { id: string; type: string; externalUrl: string | null };

let cached: ExternalUrls | null = null;
let pending: Promise<ExternalUrls> | null = null;

export function invalidateExternalUrls(): void {
  cached = null;
  pending = null;
}

function isEmptyMap(value: ExternalUrls | null): boolean {
  return !value || Object.keys(value).length === 0;
}

function fetchExternalUrls(): Promise<ExternalUrls> {
  if (!pending) {
    pending = fetch('/api/services/external-urls')
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: ExternalUrlRow[]) => {
        // The endpoint returns one row per connection (default instance first per
        // type). Collapse to a type→url map, keeping the default instance's URL.
        const map: ExternalUrls = {};
        if (Array.isArray(rows)) {
          for (const row of rows) {
            if (row.externalUrl && !map[row.type]) map[row.type] = row.externalUrl;
          }
        }
        cached = map;
        return map;
      })
      .catch(() => ({}))
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

export function useExternalUrls(): ExternalUrls {
  const [urls, setUrls] = useState<ExternalUrls>(() => cached ?? {});

  useEffect(() => {
    if (!isEmptyMap(cached)) return;
    void fetchExternalUrls().then(setUrls);
  }, []);

  return urls;
}
