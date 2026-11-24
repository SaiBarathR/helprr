import { ensureArray, jsonFetcher } from '@/lib/query-fetch';
import type { Tag } from '@/types/arr';

/** Shared by the indexer sheet and the Apps tab, so both name tags from one cached list. */
export const prowlarrTagsQuery = {
  queryKey: ['prowlarr', 'tags'],
  queryFn: jsonFetcher<Tag[]>('/api/prowlarr/tags'),
  select: ensureArray<Tag>,
  staleTime: 5 * 60_000,
};
