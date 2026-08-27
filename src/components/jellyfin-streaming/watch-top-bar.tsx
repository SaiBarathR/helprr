'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WatchSubNav } from '@/components/jellyfin-streaming/watch-subnav';
import { CinematicTopBar } from '@/components/jellyfin-streaming/cinematic/cinematic-top-bar';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
import { cn } from '@/lib/utils';

/**
 * Every Watch page gets the same chrome: a back button on the left and the
 * section nav centred. Centring the nav needs the back button's slot mirrored
 * on the right, otherwise the nav drifts left by the button's width.
 */
/** Skin switch — see use-watch-skin. */
export function WatchTopBar({ className }: { className?: string }) {
  const skin = useWatchSkin();
  if (skin === 'cinematic') return <CinematicTopBar className={className} />;
  return <ClassicTopBar className={className} />;
}

function ClassicTopBar({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Go back"
        title="Back"
        onClick={() => router.back()}
        className="shrink-0 rounded-full app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      >
        <ChevronLeft />
      </Button>
      <div className="flex min-w-0 flex-1 justify-center">
        <WatchSubNav />
      </div>
      {/* Mirrors the back button so the nav sits truly centred. */}
      <span aria-hidden className="size-9 shrink-0" />
    </div>
  );
}
