'use client';

import { useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { MANUAL_DOWNLOAD_MUTATION_KEY, ManualDownloadForm, type Service } from '@/components/torrents/manual-download-form';
import { useIsMobile } from '@/hooks/use-is-mobile';
import type { ProwlarrSearchResult } from '@/app/api/prowlarr/search/route';

/**
 * Send a search result to Sonarr or Radarr for one title, through the manual
 * download form: the server fetches the release from Prowlarr by its token,
 * checks it and pushes it, so Arr tracks, imports and cleans it up. A bottom
 * sheet on phones, a dialog on wider screens, like the request sheet.
 */
export function SendToArrSheet({
  release,
  defaultService,
  onClose,
}: {
  release: ProwlarrSearchResult | null;
  defaultService?: Service;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const open = release !== null;
  // The last result stays on screen while the sheet animates closed.
  const [shown, setShown] = useState(release);
  if (release && release !== shown) setShown(release);
  // A Check or Send on its way keeps the sheet open: its answer belongs to this form.
  const busy = useIsMutating({ mutationKey: MANUAL_DOWNLOAD_MUTATION_KEY }) > 0;
  const onOpenChange = (next: boolean) => { if (!next && !busy) onClose(); };
  const title = 'Send to Sonarr or Radarr';
  // Keyed by release: each result starts a fresh form.
  const form = shown && (
    <ManualDownloadForm
      key={shown.id}
      release={{ kind: 'prowlarr', token: shown.id }}
      suggestedName={shown.title}
      prefill={null}
      defaultService={defaultService}
      onCancel={onClose}
    />
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} dismissible={!busy}>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{shown?.title}</DrawerDescription>
          </DrawerHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">{form}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">{shown?.title}</DialogDescription>
        </DialogHeader>
        {form}
      </DialogContent>
    </Dialog>
  );
}
