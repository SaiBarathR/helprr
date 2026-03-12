import { useEffect, useState } from 'react';

type ExternalUrls = Record<string, string>;

let cached: ExternalUrls | null = null;
let pending: Promise<ExternalUrls> | null = null;

function fetchExternalUrls(): Promise<ExternalUrls> {
  if (!pending) {
    pending = fetch('/api/services/external-urls')
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: ExternalUrls) => {
        cached = data;
        return data;
      })
      .catch(() => {
        cached = {};
        return {};
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

export function useExternalUrls(): ExternalUrls {
  const [urls, setUrls] = useState<ExternalUrls>(() => cached ?? {});

  useEffect(() => {
    if (cached) return;
    void fetchExternalUrls().then(setUrls);
  }, []);

  return urls;
}
