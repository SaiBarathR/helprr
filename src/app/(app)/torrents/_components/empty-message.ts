/** What an empty torrent list says. A filtered-out list must not read like an empty client. */
export function torrentsEmptyMessage(hasSearch: boolean, hasFilters: boolean): string {
  if (hasSearch && hasFilters) return 'No torrents match your search and filters.';
  if (hasSearch) return 'No torrents match your search.';
  if (hasFilters) return 'No torrents match the active filters.';
  return 'No torrents yet.';
}
