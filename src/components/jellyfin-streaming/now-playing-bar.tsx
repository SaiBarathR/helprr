'use client';

import { ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { LiveBadge } from '@/components/jellyfin-streaming/live-badge';
import { jellyfinPosterUrl } from '@/lib/jellyfin-playback/image';
import { formatClock } from '@/lib/jellyfin-playback/device';
import { isLiveStream } from '@/lib/jellyfin-playback/live-stream';
import { FadeInImage } from '@/components/media/fade-in-image';

export function NowPlayingBar() {
  const playback = useJellyfinPlayback();
  if (playback.status === 'idle' || !playback.item) return null;
  if (playback.videoExpanded) return null;

  const poster = jellyfinPosterUrl(playback.item, 120);
  const live = isLiveStream(playback.item, playback.stream?.mediaSource);

  return (
    // Sits on the tab bar when the nav is at the bottom, else on the screen's
    // foot (home indicator in its padding), and starts after the sidebar.
    // data-now-playing-bar lets the page, toasts and floating bars clear it.
    <div
      data-now-playing-bar
      className="fixed right-0 left-[var(--app-main-left,0px)] bottom-[var(--footer-bar-bottom)] z-40 border-t px-3 pt-2 pb-[calc(0.5rem+var(--footer-bar-inset))] app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
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
          {live && !playback.error ? (
            // A broadcast has no clock to show and no progress to fill.
            <LiveBadge className="text-muted-foreground" />
          ) : (
            <>
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
            </>
          )}
        </button>
        {/* On a phone only play, next, queue and stop fit; shuffle, previous and
            repeat are in the expanded player (tap the bar). */}
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon-sm" className="hidden sm:inline-flex" onClick={playback.toggleShuffle} aria-label="Shuffle" aria-pressed={playback.shuffled}>
            <Shuffle className={playback.shuffled ? 'text-[var(--hpr-amber)]' : undefined} />
          </Button>
          <Button variant="ghost" size="icon-sm" className="hidden sm:inline-flex" onClick={() => void playback.previous()} aria-label="Previous">
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
            className="hidden sm:inline-flex"
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
