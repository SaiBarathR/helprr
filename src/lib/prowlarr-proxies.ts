import type { ProwlarrIndexer, ProwlarrIndexerProxy, ProwlarrTestAllResponse } from '@/lib/prowlarr-client';

/** What the browser gets of an indexer proxy: never its `fields` (host, username, password). */
export interface ProwlarrIndexerProxySummary {
  id: number;
  name: string;
  implementation: string;
  implementationName: string;
  tags: number[];
  /**
   * The indexers that use it: Prowlarr sends a saved indexer through a proxy
   * that shares a tag with it, so a proxy with no tags serves none.
   */
  indexers: { id: number; name: string }[];
}

export function toProxySummaries(proxies: ProwlarrIndexerProxy[], indexers: ProwlarrIndexer[]): ProwlarrIndexerProxySummary[] {
  return proxies.map((proxy) => {
    const tags = Array.isArray(proxy.tags) ? proxy.tags.filter((tag) => Number.isSafeInteger(tag)) : [];
    return {
      id: proxy.id,
      name: String(proxy.name ?? ''),
      implementation: String(proxy.implementation ?? ''),
      implementationName: String(proxy.implementationName ?? ''),
      tags,
      indexers: indexers
        .filter((indexer) => (indexer.tags ?? []).some((tag) => tags.includes(tag)))
        .map((indexer) => ({ id: indexer.id, name: indexer.name })),
    };
  });
}

/**
 * Pass or fail per proxy, without Prowlarr's failure text: it can name the
 * proxy's host, which is one of the settings kept on the server.
 */
export function toProxyTestAll(response: ProwlarrTestAllResponse): ProwlarrTestAllResponse {
  return {
    passed: response.passed,
    failed: response.failed,
    hasFailures: response.hasFailures,
    results: response.results.map((result) => ({ id: result.id, isValid: result.isValid, validationFailures: [] })),
  };
}
