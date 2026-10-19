'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose } from '@/components/ui/drawer';
import { Loader2 } from 'lucide-react';

export interface DeleteDrawerState {
  open: boolean;
  hash: string;
  name: string;
  deleteFiles: boolean;
}

/** Confirms deleting one torrent or the selected ones, with the files only when asked. */
export function TorrentDeleteDrawer({
  deleteDrawer,
  setDeleteDrawer,
  handleDelete,
  deleting,
}: {
  deleteDrawer: DeleteDrawerState;
  setDeleteDrawer: Dispatch<SetStateAction<DeleteDrawerState>>;
  handleDelete: () => void;
  deleting: boolean;
}) {
  return (
    <Drawer open={deleteDrawer.open} onOpenChange={(open) => !open && setDeleteDrawer({ ...deleteDrawer, open: false })}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Delete Torrent</DrawerTitle>
          <DrawerDescription>
            Are you sure you want to delete &ldquo;{deleteDrawer.name}&rdquo;?
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteDrawer.deleteFiles}
              onChange={(e) => setDeleteDrawer({ ...deleteDrawer, deleteFiles: e.target.checked })}
              className="rounded border-border"
            />
            <span className="text-sm">Also delete downloaded files</span>
          </label>
          {deleteDrawer.deleteFiles && (
            <p className="text-xs text-destructive">
              Warning: This will permanently delete the downloaded files from disk.
            </p>
          )}
        </div>

        <DrawerFooter>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="w-full">
            {deleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete'
            )}
          </Button>
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
