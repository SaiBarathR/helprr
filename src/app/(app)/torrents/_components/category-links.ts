import type { QBittorrentCategory } from '@/lib/qbittorrent-client';

// Pages, not drawers: their text fields bring up the on-screen keyboard, which
// pushes a drawer out of view on iOS.
export const NEW_CATEGORY_HREF = '/torrents/categories/new';

/** A query parameter, not a path segment: a subcategory's name holds "/". */
export function editCategoryHref(name: string): string {
  return `/torrents/categories/edit?name=${encodeURIComponent(name)}`;
}

/** The folder its torrents save in: its own, or qBittorrent's default plus its name. */
export function categoryFolder(category: QBittorrentCategory, defaultSavePath: string): string {
  if (category.savePath) return category.savePath;
  const root = defaultSavePath.replace(/[\\/]+$/, '');
  return root ? `${root}/${category.name} (default)` : 'Default folder';
}
