import { getProwlarrClient } from '@/lib/service-helpers';
import { matchLocalQuery } from '@/lib/search/providers/local-module';
import { redactProwlarrText } from '@/lib/prowlarr-redact';
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
  const indexerNames = new Map(indexers.map((indexer) => [indexer.id, indexer.name]));

  // Indexers first: their rows open the sheet, and one indexer's history can fill the limit.
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
      route: `/prowlarr?indexer=${indexer.id}`,
      provider: 'prowlarr',
      badge: indexer.enable ? undefined : 'Disabled',
    });
    if (results.length >= limit) break;
  }

  for (const record of history.records) {
    // Prowlarr keeps the search text in the record's data, and names the indexer only by id.
    const searched = redactProwlarrText(record.data?.query ?? '');
    const indexerName = indexerNames.get(record.indexerId) ?? '';
    if (!matchLocalQuery(query, searched, indexerName, record.eventType)) continue;
    const id = `prowlarr:history:${record.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    results.push({
      id,
      title: searched || indexerName || record.eventType,
      subtitle: [indexerName, record.eventType, record.successful === false ? 'Failed' : 'OK']
        .filter(Boolean)
        .join(' · '),
      year: null,
      poster: null,
      route: '/prowlarr',
      provider: 'prowlarr',
    });
    if (results.length >= limit) break;
  }

  return { results: results.slice(0, limit) };
};
