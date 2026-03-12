import { useEffect, useState } from 'react';

type ExternalUrls = Record<string, string>;

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
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: ExternalUrls) => {
        if (data && typeof data === 'object') {
          cached = data;
        }
        return data;
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
