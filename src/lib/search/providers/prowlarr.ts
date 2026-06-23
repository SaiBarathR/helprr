import { getProwlarrClient } from '@/lib/service-helpers';
import { matchLocalQuery } from '@/lib/search/providers/local-module';
import type { ProviderHandler } from '@/lib/search/providers/types';
import type { SearchProviderResult } from '@/lib/search/types';

export const searchProwlarr: ProviderHandler = async ({ query, limit }) => {
  const client = await getProwlarrClient();

  const [history, indexers] = await Promise.all([
    client.getHistory({ page: 1, pageSize: 200 }),
    client.getIndexers().catch(() => []),
  ]);

  const results: SearchProviderResult[] = [];
  const seen = new Set<string>();

  for (const record of history.records) {
    if (!matchLocalQuery(query, record.query, record.indexer, record.eventType)) continue;
    const id = `prowlarr:history:${record.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    results.push({
      id,
      title: record.query || record.indexer,
      subtitle: [record.indexer, record.eventType, record.successful === false ? 'Failed' : 'OK']
        .filter(Boolean)
        .join(' · '),
      year: null,
      poster: null,
      route: '/prowlarr',
      provider: 'prowlarr',
    });
    if (results.length >= limit) break;
  }

  if (results.length < limit) {
    for (const indexer of indexers) {
      if (!matchLocalQuery(query, indexer.name, indexer.implementationName)) continue;
      const id = `prowlarr:indexer:${indexer.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      results.push({
        id,
        title: indexer.name,
        subtitle: [indexer.implementationName, indexer.enable ? 'Enabled' : 'Disabled'].join(' · '),
        year: null,
        poster: null,
        route: '/prowlarr',
        provider: 'prowlarr',
        badge: indexer.enable ? undefined : 'Disabled',
      });
      if (results.length >= limit) break;
    }
  }

  return { results };
};
