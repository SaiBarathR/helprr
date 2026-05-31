'use client';

import { useState } from 'react';
import { Inbox, Check } from 'lucide-react';
import { SeerrRequestModal } from '@/components/seerr/seerr-request-modal';
import { useRequestedMedia } from '@/components/seerr/requested-media-provider';

interface RequestMediaButtonProps {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title?: string;
  className?: string;
  label?: string;
}

/**
 * Opens the full Seerr request modal (season selection, quality profile, root
 * folder, tags, and — for admins — Request As). The request is attributed
 * server-side to the chosen / caller's linked Seerr user.
 */
export function RequestMediaButton({
  tmdbId,
  mediaType,
  title = '',
  className,
  label = 'Request',
}: RequestMediaButtonProps) {
  const [open, setOpen] = useState(false);
  const { isRequested, markRequested } = useRequestedMedia();
  // Persisted across remounts/navigation via the shared provider, so a request
  // held for approval keeps reading "Requested" until it's resolved.
  const requested = isRequested(mediaType, tmdbId);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={requested} className={className}>
        {requested ? <Check className="h-3.5 w-3.5" /> : <Inbox className="h-3.5 w-3.5" />}
        <span className="tracking-widest">{requested ? 'Requested' : label}</span>
      </button>
      <SeerrRequestModal
        open={open}
        onOpenChange={setOpen}
        mode="create"
        mediaType={mediaType}
        tmdbId={tmdbId}
        title={title}
        onDone={() => markRequested(mediaType, tmdbId)}
      />
    </>
  );
}
