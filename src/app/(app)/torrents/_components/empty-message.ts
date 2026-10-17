/** What an empty torrent list says. A filtered-out list must not read like an empty client. */
export function torrentsEmptyMessage(hasSearch: boolean, hasStatusFilter: boolean): string {
  if (hasSearch && hasStatusFilter) return 'No torrents match your search and filters.';
  if (hasSearch) return 'No torrents match your search.';
  if (hasStatusFilter) return 'No torrents match the active filters.';
  return 'No torrents yet.';
}
