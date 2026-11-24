'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CornerLeftUp, Folder, FolderOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { ErrorState } from '@/components/ui/error-state';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import type { FolderListing } from '@/app/api/qbittorrent/folders/route';

/** The save-path field the picker fills, which decides who may list and where (see the folders route). */
export type FolderPurpose = 'add' | 'location' | 'category';

// A bottom sheet on phones, a dialog on wider screens, like the request sheet.
const FRAMES = {
  drawer: { Header: DrawerHeader, Title: DrawerTitle, Description: DrawerDescription, Footer: DrawerFooter },
  dialog: { Header: DialogHeader, Title: DialogTitle, Description: DialogDescription, Footer: DialogFooter },
};
type Frame = keyof typeof FRAMES;

const TOP_LABEL: Record<FolderPurpose, string> = {
  add: 'Download folders',
  location: 'Download folders',
  category: 'Default save path',
};

function folderListUrl(purpose: FolderPurpose, path: string | null): string {
  const params = new URLSearchParams({ for: purpose });
  if (path) params.set('path', path);
  return `/api/qbittorrent/folders?${params}`;
}

/**
 * A Browse button beside a save-path field: it opens a sheet that drills into
 * qBittorrent's download folders and fills the field with the one picked.
 * Typing a path stays possible; the field's own check still applies.
 */
export function FolderPickerButton({
  purpose,
  value,
  onPick,
  disabled,
}: {
  purpose: FolderPurpose;
  /** The field's text: the sheet opens there when it is a folder it may list. */
  value: string;
  onPick: (path: string) => void;
  disabled?: boolean;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(null);
  // Mounted per opening: each one starts at the field's folder.
  const browser = (frame: Frame) => open && (
    <FolderBrowser
      frame={frame}
      purpose={purpose}
      start={start}
      onPick={(path) => {
        onPick(path);
        setOpen(false);
      }}
    />
  );
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="relative touch-target shrink-0"
        aria-label="Browse folders"
        disabled={disabled}
        onClick={() => {
          setStart(value.trim() || null);
          setOpen(true);
        }}
      >
        <FolderOpen className="h-4 w-4" />
      </Button>
      {isMobile ? (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent>{browser('drawer')}</DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">{browser('dialog')}</DialogContent>
        </Dialog>
      )}
    </>
  );
}

function FolderBrowser({
  frame,
  purpose,
  start,
  onPick,
}: {
  frame: Frame;
  purpose: FolderPurpose;
  start: string | null;
  onPick: (path: string) => void;
}) {
  const [path, setPath] = useState<string | null>(start);
  // The typed folder could not be listed (outside, or not made yet): start from the top instead.
  const [startRefused, setStartRefused] = useState(false);

  const query = useQuery({
    queryKey: ['qbittorrent', 'folders', purpose, path ?? ''],
    queryFn: jsonFetcher<FolderListing>(folderListUrl(purpose, path)),
    staleTime: 15_000,
    retry: false,
  });
  const listing = query.data;
  const refused = query.error instanceof ApiError && (query.error.status === 400 || query.error.status === 404);
  if (refused && path !== null && path === start && !startRefused) {
    setStartRefused(true);
    setPath(null);
  }

  const open = (next: string | null) => {
    setStartRefused(false);
    setPath(next);
  };
  const top = TOP_LABEL[purpose];
  const { Header, Title, Description, Footer } = FRAMES[frame];
  const drawer = frame === 'drawer';
  const parentName = listing?.parent ? listing.parent.slice(listing.parent.lastIndexOf('/') + 1) || listing.parent : top;

  return (
    <>
      <Header className="text-left">
        <Title>Choose Folder</Title>
        <Description className="break-all">{listing?.path ?? path ?? top}</Description>
      </Header>
      <div className={drawer ? 'flex-1 min-h-0 overflow-y-auto px-4' : 'min-h-0 flex-1 overflow-y-auto'}>
        {startRefused && (
          <p className="mb-3 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {start} can&apos;t be listed here, so this starts from the {top.toLowerCase()}.
          </p>
        )}
        <div className="rounded-lg border divide-y">
          {path !== null && (
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-primary hover:bg-accent transition-colors"
              disabled={query.isLoading}
              onClick={() => open(listing?.parent ?? null)}
            >
              <CornerLeftUp className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">{parentName}</span>
            </button>
          )}
          {query.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !listing ? (
            <ErrorState
              compact
              message={(query.error instanceof ApiError && query.error.code) || 'Failed to list the folders'}
              onRetry={() => void query.refetch()}
              retrying={query.isFetching}
            />
          ) : listing.folders.length === 0 ? (
            <p className="px-3 py-3 text-center text-sm text-muted-foreground">
              {listing.path === null ? 'qBittorrent has no download folder Helprr can list' : 'No folders in here'}
            </p>
          ) : (
            listing.folders.map((name) => (
              <button
                key={name}
                type="button"
                className="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent transition-colors"
                onClick={() => open(listing.path === null ? name : `${listing.path}/${name}`)}
              >
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{name}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
        {listing?.truncated && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing the first {listing.folders.length} of {listing.total} folders. Type the path to reach the others.
          </p>
        )}
      </div>
      <Footer>
        <Button type="button" className={drawer ? 'h-11' : undefined} disabled={!listing?.path} onClick={() => listing?.path && onPick(listing.path)}>
          Use This Folder
        </Button>
      </Footer>
    </>
  );
}
