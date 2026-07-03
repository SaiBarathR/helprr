import {
  normalizeSearchAlias,
  SEARCH_PROVIDER_DEFS,
  type SearchProviderDef,
} from '@/lib/search/provider-defs';

/**
 * Suggest scopes for palette input. Typing never activates a scope — plain
 * text always searches locally, so titles like "Ani the Guardian" stay
 * searchable. A scope is committed explicitly (Tab or selecting a suggestion),
 * at which point it lives as palette state, not as part of the input string.
 */
export function suggestScopes(input: string): SearchProviderDef[] {
  const token = normalizeSearchAlias(input);
  if (!/^[a-z]{1,3}$/.test(token)) return [];
  return SEARCH_PROVIDER_DEFS.filter(
    (d) => d.alias.startsWith(token) || d.id.startsWith(token)
  );
}
