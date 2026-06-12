'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { VideoPlayer } from '@/components/player/video-player';

// Jellyfin item ids are 32-char hex (sometimes dashed guids).
const ITEM_ID_PATTERN = /^[0-9a-fA-F-]{8,40}$/;

export default function WatchPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const searchParams = useSearchParams();

  if (!itemId || !ITEM_ID_PATTERN.test(itemId)) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-white/60">
        Invalid item
      </div>
    );
  }

  // ?t=<ticks> resumes at a position; absent → the item's saved position.
  const rawT = searchParams.get('t');
  const t = rawT === null ? undefined : Number(rawT);
  const startTicks = t !== undefined && Number.isFinite(t) && t >= 0 ? t : undefined;

  return <VideoPlayer itemId={itemId} startTicks={startTicks} />;
}
