import {
  normalizeSearchAlias,
  resolveProviderFromAlias,
  SEARCH_PROVIDER_DEFS,
  type SearchProviderDef,
} from '@/lib/search/provider-defs';
import type { SearchProviderId } from '@/lib/search/types';

export type ParsedSearchQuery =
  | { mode: 'empty' }
  | { mode: 'local'; query: string }
  | { mode: 'scope-help'; provider: SearchProviderId; def: SearchProviderDef }
  | { mode: 'scoped-empty'; provider: SearchProviderId; def: SearchProviderDef }
  | { mode: 'scoped'; provider: SearchProviderId; def: SearchProviderDef; query: string }
  | { mode: 'scope-suggest'; partial: string; suggestions: SearchProviderDef[] };

/**
 * Parse palette input into local vs scoped search modes.
 * Scoped search requires `<alias><space><query>` — e.g. `tm dune`.
 * Typing `tm` alone (exact alias) shows scope help; `tmatrix` stays local.
 */
export function parseSearchQuery(input: string): ParsedSearchQuery {
  if (!input.trim()) return { mode: 'empty' };

  const leading = input.trimStart();

  // Alias + space + query body — check before trim() so `tm ` stays scoped-empty.
  const withSpace = leading.match(/^([a-z]{2,3})\s+(.*)$/i);
  if (withSpace) {
    const def = resolveProviderFromAlias(withSpace[1]);
    if (def) {
      const body = withSpace[2].trim();
      if (!body) return { mode: 'scoped-empty', provider: def.id, def };
      return { mode: 'scoped', provider: def.id, def, query: body };
    }
  }

  // Exact alias with no trailing space → scope help (e.g. `tm`).
  const exactDef = resolveProviderFromAlias(leading);
  if (exactDef && normalizeSearchAlias(leading) === exactDef.alias) {
    return { mode: 'scope-help', provider: exactDef.id, def: exactDef };
  }

  // Partial alias prefix suggestions (e.g. `t`, `an` before space).
  if (/^[a-z]{1,3}$/i.test(leading)) {
    const partial = normalizeSearchAlias(leading);
    const suggestions = SEARCH_PROVIDER_DEFS.filter(
      (d) => d.alias.startsWith(partial) || d.id.startsWith(partial)
    );
    if (suggestions.length > 0 && suggestions.length < SEARCH_PROVIDER_DEFS.length) {
      return { mode: 'scope-suggest', partial, suggestions };
    }
  }

  return { mode: 'local', query: input.trim() };
}
