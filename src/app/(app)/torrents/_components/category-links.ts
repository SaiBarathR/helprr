import type { CategoryDetails } from './use-categories';

// Pages, not drawers: their text fields bring up the on-screen keyboard, which
// pushes a drawer out of view on iOS.
export const NEW_CATEGORY_HREF = '/torrents/categories/new';

/** A query parameter, not a path segment: a subcategory's name holds "/". */
export function editCategoryHref(name: string): string {
  return `/torrents/categories/edit?name=${encodeURIComponent(name)}`;
}

/**
 * Where a category with no save path of its own saves, as qBittorrent works it
 * out: <default save path>/<name>, or in subcategory mode the parent's folder
 * plus the last part ("tv/anime" under a "tv" at /data/tv is /data/tv/anime).
 */
export function defaultCategoryFolder(name: string, details: CategoryDetails): string {
  const cut = details.subcategories ? name.lastIndexOf('/') : -1;
  if (cut > 0) {
    const parent = name.slice(0, cut);
    const own = Object.hasOwn(details.categories, parent) ? details.categories[parent].savePath : '';
    return `${(own || defaultCategoryFolder(parent, details)).replace(/[\\/]+$/, '')}/${name.slice(cut + 1)}`;
  }
  return `${details.defaultSavePath.replace(/[\\/]+$/, '')}/${name}`;
}

/**
 * Where qBittorrent saves a torrent added with no save path, as 5.1.4 does it:
 * under automatic management in its category's folder (no category: the
 * default save path); under manual management in the default save path, or in
 * the category's folder when "Use Category paths in Manual Mode" is on.
 * `autoTmm` undefined is qBittorrent's default mode. null when qBittorrent
 * didn't send the setting that decides it.
 */
export function addSaveFolder(details: CategoryDetails, category: string | undefined, autoTmm: boolean | undefined): string | null {
  const auto = autoTmm ?? details.autoTmmByDefault;
  if (auto === null) return null;
  const root = details.defaultSavePath;
  if (!category) return root;
  if (!auto) {
    if (details.categoryPathsInManualMode === null) return null;
    if (!details.categoryPathsInManualMode) return root;
  }
  const own = Object.hasOwn(details.categories, category) ? details.categories[category].savePath : '';
  return own || defaultCategoryFolder(category, details);
}
