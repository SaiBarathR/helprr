'use client';

import { ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { jellyfinPosterUrl } from '@/lib/jellyfin-playback/image';
import { formatClock } from '@/lib/jellyfin-playback/device';
import { FadeInImage } from '@/components/media/fade-in-image';

export function NowPlayingBar() {
  const playback = useJellyfinPlayback();
  if (playback.status === 'idle' || !playback.item) return null;
  if (playback.videoExpanded) return null;

  const poster = jellyfinPosterUrl(playback.item, 120);

  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t px-3 py-2 md:bottom-0 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <button
          type="button"
          className="relative size-11 shrink-0 overflow-hidden rounded-md bg-muted"
          onClick={() => playback.setVideoExpanded(true)}
        >
          {poster && <FadeInImage src={poster} alt="" fill sizes="44px" unoptimized className="object-cover" />}
        </button>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => playback.setVideoExpanded(true)}>
          <p className="truncate text-sm font-medium">{playback.item.Name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {playback.error
              ? playback.error
              : `${playback.item.Artists?.join(', ') || playback.item.SeriesName || playback.item.AlbumArtist || ''} · ${formatClock(playback.positionSeconds)} / ${formatClock(playback.durationSeconds)}`}
          </p>
          <div className="mt-1 h-1 overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-[var(--hpr-amber)]"
              style={{ width: `${playback.durationSeconds ? (playback.positionSeconds / playback.durationSeconds) * 100 : 0}%` }}
            />
          </div>
        </button>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={playback.toggleShuffle} aria-label="Shuffle" aria-pressed={playback.shuffled}>
            <Shuffle className={playback.shuffled ? 'text-[var(--hpr-amber)]' : undefined} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => void playback.previous()} aria-label="Previous">
            <SkipBack />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={playback.togglePause} aria-label={playback.status === 'paused' ? 'Play' : 'Pause'}>
            {playback.status === 'paused' ? <Play className="fill-current" /> : <Pause className="fill-current" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => void playback.next()} aria-label="Next">
            <SkipForward />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => playback.setRepeat(playback.repeat === 'RepeatNone' ? 'RepeatAll' : playback.repeat === 'RepeatAll' ? 'RepeatOne' : 'RepeatNone')}
            aria-label="Repeat"
          >
            {playback.repeat === 'RepeatOne' ? <Repeat1 className="text-[var(--hpr-amber)]" /> : <Repeat className={playback.repeat === 'RepeatAll' ? 'text-[var(--hpr-amber)]' : undefined} />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => playback.setQueueOpen(true)} aria-label="Queue">
            <ListMusic />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => void playback.stop()} aria-label="Stop">
            <X />
          </Button>
        </div>
      </div>
    </div>
  );
}
