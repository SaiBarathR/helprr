'use client';

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Loader2 } from 'lucide-react';

/** One torrent's, or the selection's, drawer state; `hash` joins several hashes with '|'. */
export type CategoryDrawerState = { open: boolean; hash: string; bulk?: boolean };

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
                <button
                  key={key}
                  className="flex items-center justify-between gap-3 w-full px-3 py-3 text-sm hover:bg-accent transition-colors"
                  onClick={() => pick(cat.name)}
                >
                  <span className="min-w-0 truncate text-left">{cat.name}</span>
                  {cat.savePath && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[50%]">{cat.savePath}</span>
                  )}
                </button>
              ))}
              {Object.keys(categories).length === 0 && (
                <p className="px-3 py-3 text-sm text-muted-foreground text-center">No categories found</p>
              )}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
