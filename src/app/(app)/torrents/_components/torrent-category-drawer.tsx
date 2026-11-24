'use client';

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Loader2, Plus } from 'lucide-react';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { useMe } from '@/components/permission-provider';
import { NEW_CATEGORY_HREF } from './category-links';

/** One torrent's, or the selection's, drawer state; `hash` joins several hashes with '|'. */
export type CategoryDrawerState = { open: boolean; hash: string; bulk?: boolean };

// "New category" is a page (its text field brings up the keyboard): the drawer
// hands what it was for to the torrents page it returns to, in memory like the
// bulk limits' targets, so the selection and the drawer come back. Ten minutes
// at most, so a later visit to Torrents doesn't open it out of nowhere.
const RETURN_MAX_AGE_MS = 10 * 60_000;
let pendingReturn: { hash: string; bulk?: boolean; at: number } | null = null;

/** The drawer to open again on the torrents page after New category; it stays until taken. */
export function peekCategoryDrawerReturn(now = Date.now()): { hash: string; bulk?: boolean } | null {
  const back = pendingReturn;
  return back && now - back.at <= RETURN_MAX_AGE_MS ? { hash: back.hash, bulk: back.bulk } : null;
}

/** Done with it: the next visit to Torrents opens nothing. */
export function clearCategoryDrawerReturn(): void {
  pendingReturn = null;
}

/** Picks the category (or none) for a torrent or the selected torrents from qBittorrent's categories. */
export function TorrentCategoryDrawer({
  categoryDrawer,
  setCategoryDrawer,
  categoriesLoading,
  categories,
  pickCategory,
}: {
  categoryDrawer: CategoryDrawerState;
  setCategoryDrawer: (drawer: CategoryDrawerState) => void;
  categoriesLoading: boolean;
  categories: Record<string, { name: string; savePath: string }>;
  pickCategory: (category: string) => Promise<unknown>;
}) {
  const router = useRouter();
  // The API lets only an admin create one.
  const canCreate = useMe()?.role === 'admin';
  const count = categoryDrawer.hash ? categoryDrawer.hash.split('|').length : 0;
  const pick = async (category: string) => {
    await pickCategory(category);
    setCategoryDrawer({ open: false, hash: '' });
  };
  return (
    <Drawer open={categoryDrawer.open} onOpenChange={(open) => !open && setCategoryDrawer({ open: false, hash: '' })}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{categoryDrawer.bulk ? `Set Category for ${count} torrent${count === 1 ? '' : 's'}` : 'Set Category'}</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 flex-1 min-h-0 overflow-y-auto">
          {categoriesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-lg border divide-y">
              <button
                className="flex items-center w-full px-3 py-3 text-sm hover:bg-accent transition-colors"
                onClick={() => pick('')}
              >
                <span className="text-muted-foreground italic">None</span>
              </button>
              {Object.entries(categories).map(([key, cat]) => (
                // The name in full and the folder under it, cut with an ellipsis:
                // side by side, two long names cut alike looked the same.
                <button
                  key={key}
                  className="flex flex-col items-start gap-0.5 w-full min-h-11 px-3 py-2.5 text-sm text-left hover:bg-accent transition-colors"
                  onClick={() => pick(cat.name)}
                >
                  <span className="max-w-full break-words">{cat.name}</span>
                  {cat.savePath && (
                    <span className="max-w-full truncate text-xs text-muted-foreground">{cat.savePath}</span>
                  )}
                </button>
              ))}
              {Object.keys(categories).length === 0 && (
                <p className="px-3 py-3 text-sm text-muted-foreground text-center">No categories found</p>
              )}
              {canCreate && (
                <button
                  className="flex items-center gap-2 w-full px-3 py-3 text-sm text-primary hover:bg-accent transition-colors"
                  onClick={() => {
                    pendingReturn = { hash: categoryDrawer.hash, bulk: categoryDrawer.bulk, at: Date.now() };
                    setCategoryDrawer({ open: false, hash: '' });
                    router.push(NEW_CATEGORY_HREF);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  New category
                </button>
              )}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
