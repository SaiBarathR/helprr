import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import type { ProwlarrClient } from '@/lib/prowlarr-client';
import { parseProwlarrCategoryTree, type ProwlarrCategory } from '@/lib/prowlarr-search';

const CACHE_SCOPE = 'prowlarr-categories';
// The tree is Prowlarr's fixed standard list, the same on every Prowlarr, so
// one key will do; the TTL only spares a call on every search that names one.
const CACHE_TTL_SECONDS = 10 * 60;

/** Prowlarr's category tree, parsed, from a short cache when there is one. */
export async function getProwlarrCategoryTree(client: ProwlarrClient): Promise<ProwlarrCategory[]> {
  const cached = await getCachedJson<ProwlarrCategory[]>(CACHE_SCOPE, 'tree');
  if (cached) return cached;
  const tree = parseProwlarrCategoryTree(await client.getCategories());
  // An empty answer is not kept, so the next search asks again.
  if (tree.length > 0) await setCachedJson(CACHE_SCOPE, 'tree', tree, CACHE_TTL_SECONDS);
  return tree;
}
