'use client';

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Loader2 } from 'lucide-react';

/** Picks a torrent's category (or none) from qBittorrent's categories. */
export function TorrentCategoryDrawer({
  categoryDrawer,
  setCategoryDrawer,
  categoriesLoading,
  categories,
  torrentAction,
}: {
  categoryDrawer: { open: boolean; hash: string };
  setCategoryDrawer: (drawer: { open: boolean; hash: string }) => void;
  categoriesLoading: boolean;
  categories: Record<string, { name: string; savePath: string }>;
  torrentAction: (hash: string, action: string, extra?: Record<string, unknown>, opts?: { silent?: boolean }) => Promise<boolean | 'gone'>;
}) {
  return (
    <Drawer open={categoryDrawer.open} onOpenChange={(open) => !open && setCategoryDrawer({ open: false, hash: '' })}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Set Category</DrawerTitle>
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
                onClick={async () => {
                  await torrentAction(categoryDrawer.hash, 'setCategory', { category: '' });
                  setCategoryDrawer({ open: false, hash: '' });
                }}
              >
                <span className="text-muted-foreground italic">None</span>
              </button>
              {Object.entries(categories).map(([key, cat]) => (
                <button
                  key={key}
                  className="flex items-center justify-between gap-3 w-full px-3 py-3 text-sm hover:bg-accent transition-colors"
                  onClick={async () => {
                    await torrentAction(categoryDrawer.hash, 'setCategory', { category: cat.name });
                    setCategoryDrawer({ open: false, hash: '' });
                  }}
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
