'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ListPlus,
  Loader2,
  Play,
  RotateCcw,
  Shuffle,
  Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Button } from '@/components/ui/button';
import { useCan } from '@/components/permission-provider';
import { formatTime } from '@/lib/playback/time';
import { ticksToSeconds } from '@/lib/playback/player-machine';
import { useMusicStore, type MusicTrack } from '@/lib/playback/music-store';
import type { JellyfinItem } from '@/types/jellyfin';

const ID_PATTERN = /^[0-9a-fA-F-]{8,40}$/;
const TICKS_PER_MINUTE = 600_000_000;

function formatRuntime(ticks?: number): string | null {
  if (!ticks) return null;
  const minutes = Math.round(ticks / TICKS_PER_MINUTE);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function EpisodeRow({
  episode,
  canPlay,
  onPlay,
}: {
  episode: JellyfinItem;
  canPlay: boolean;
  onPlay: (episode: JellyfinItem) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const progress = episode.UserData?.PlayedPercentage;
  const runtime = formatRuntime(episode.RunTimeTicks);
  const body = (
    <>
      <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-md border bg-muted/40">
        {!imgFailed && (
          // eslint-disable-next-line @next/next/no-img-element -- proxied, size-capped upstream
          <img
            src={`/api/jellyfin/image?itemId=${episode.Id}&type=Primary&maxWidth=300`}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        )}
        {canPlay && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
            <Play className="h-6 w-6 fill-white text-white" aria-hidden />
          </div>
        )}
        {progress !== undefined && progress > 0 && progress < 100 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {episode.IndexNumber !== undefined && (
            <span className="text-muted-foreground">E{episode.IndexNumber} · </span>
          )}
          {episode.Name}
        </p>
        {episode.Overview && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{episode.Overview}</p>
        )}
        {runtime && <p className="mt-0.5 text-[11px] text-muted-foreground">{runtime}</p>}
      </div>
      {episode.UserData?.Played && (
        <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Watched" />
      )}
    </>
  );

  if (!canPlay) {
    return <div className="flex items-start gap-3 px-2 py-2">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => onPlay(episode)}
      className="group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
    >
      {body}
    </button>
  );
}

function SeasonAccordion({
  name,
  episodes,
  expanded,
  canPlay,
  onToggle,
  onPlay,
}: {
  name: string;
  episodes: JellyfinItem[];
  expanded: boolean;
  canPlay: boolean;
  onToggle: () => void;
  onPlay: (episode: JellyfinItem) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const seasonId = episodes[0]?.SeasonId;
  const watched = episodes.filter((e) => e.UserData?.Played).length;
  return (
    <div className="border-b border-border/50">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-accent"
      >
        {seasonId && !imgFailed && (
          <div className="relative h-[64px] w-[43px] shrink-0 overflow-hidden rounded border bg-muted/40">
            {/* eslint-disable-next-line @next/next/no-img-element -- proxied, size-capped upstream */}
            <img
              src={`/api/jellyfin/image?itemId=${seasonId}&type=Primary&maxWidth=120`}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              onError={() => setImgFailed(true)}
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {episodes.length} episode{episodes.length === 1 ? '' : 's'} · {watched} watched
          </p>
        </div>
        {episodes.length > 0 && watched === episodes.length && (
          <Check className="h-4 w-4 shrink-0 text-primary" aria-label="All watched" />
        )}
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
      {expanded && (
        <div className="space-y-1 pb-3">
          {episodes.map((episode) => (
            <EpisodeRow key={episode.Id} episode={episode} canPlay={canPlay} onPlay={onPlay} />
          ))}
        </div>
      )}
    </div>
  );
}

function TrackRow({
  track,
  position,
  canPlay,
  onPlay,
  onEnqueue,
}: {
  track: JellyfinItem;
  position: number;
  canPlay: boolean;
  onPlay: () => void;
  onEnqueue: () => void;
}) {
  const body = (
    <>
      <span className="w-6 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {track.IndexNumber ?? position}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{track.Name}</span>
      {track.RunTimeTicks !== undefined && (
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {formatTime(ticksToSeconds(track.RunTimeTicks))}
        </span>
      )}
    </>
  );
  if (!canPlay) {
    return <div className="flex items-center gap-3 px-2 py-2">{body}</div>;
  }
  return (
    <div className="group flex items-center gap-1 rounded-lg transition-colors hover:bg-accent">
      <button
        type="button"
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left"
      >
        {body}
      </button>
      <button
        type="button"
        onClick={onEnqueue}
        aria-label={`Add ${track.Name} to queue`}
        className="mr-1 rounded-full p-2 text-muted-foreground transition-colors hover:bg-background/60"
      >
        <ListPlus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

export default function JellyfinItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const router = useRouter();
  const canPlay = useCan('jellyfin.play');
  const validId = Boolean(itemId && ID_PATTERN.test(itemId));

  const [item, setItem] = useState<JellyfinItem | null>(null);
  const [episodes, setEpisodes] = useState<JellyfinItem[] | null>(null);
  const [tracks, setTracks] = useState<JellyfinItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posterFailed, setPosterFailed] = useState(false);
  const [playLoading, setPlayLoading] = useState(false);
  // null = default: single-season series start expanded, multi-season collapsed.
  const [expandedSeasons, setExpandedSeasons] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    fetch(`/api/jellyfin/items/${itemId}`)
      .then(async (res) => {
        const data = (await res.json()) as {
          item?: JellyfinItem | null;
          linked?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.item) {
          setError(
            data.linked === false
              ? "Your Helprr account isn't linked to a Jellyfin user."
              : data.error ?? 'Failed to load item'
          );
          return;
        }
        setItem(data.item);
        if (data.item.Type === 'Series') {
          fetch(`/api/jellyfin/items/${itemId}/episodes`)
            .then(async (epRes) => {
              if (!epRes.ok) return;
              const epData = (await epRes.json()) as { items?: JellyfinItem[] };
              if (!cancelled) setEpisodes(epData.items ?? []);
            })
            .catch(() => {});
        } else if (data.item.Type === 'MusicAlbum') {
          fetch(`/api/jellyfin/items/${itemId}/tracks`)
            .then(async (trackRes) => {
              if (!trackRes.ok) return;
              const trackData = (await trackRes.json()) as { items?: JellyfinItem[] };
              if (!cancelled) setTracks(trackData.items ?? []);
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load item');
      });
    return () => {
      cancelled = true;
    };
  }, [validId, itemId]);

  const seasons = useMemo(() => {
    if (!episodes) return null;
    const groups = new Map<string, JellyfinItem[]>();
    for (const ep of episodes) {
      const key = ep.SeasonName ?? `Season ${ep.ParentIndexNumber ?? '?'}`;
      const group = groups.get(key);
      if (group) group.push(ep);
      else groups.set(key, [ep]);
    }
    return [...groups.entries()];
  }, [episodes]);

  const effectiveExpanded =
    expandedSeasons ??
    (seasons && seasons.length === 1 ? new Set([seasons[0][0]]) : new Set<string>());

  const toggleSeason = (name: string) => {
    const next = new Set(effectiveExpanded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpandedSeasons(next);
  };

  const playEpisode = (episode: JellyfinItem) => {
    router.push(`/watch/${episode.Id}`);
  };

  const musicQueue = useMemo<MusicTrack[]>(() => {
    if (!item || !tracks) return [];
    return tracks.map((t) => ({
      id: t.Id,
      name: t.Name,
      artist: t.Artists?.[0] ?? t.AlbumArtist ?? item.AlbumArtist,
      album: item.Name,
      albumId: item.Id,
      runTimeTicks: t.RunTimeTicks,
      container: t.Container ?? t.MediaSources?.[0]?.Container,
    }));
  }, [item, tracks]);

  const playSeries = async () => {
    setPlayLoading(true);
    try {
      const res = await fetch(`/api/jellyfin/play/next-up?seriesId=${itemId}`);
      const data = (await res.json()) as { itemId?: string | null };
      if (data.itemId) router.push(`/watch/${data.itemId}`);
    } finally {
      setPlayLoading(false);
    }
  };

  if (!validId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Invalid item
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }
  if (!item) return <PageSpinner />;

  const runtime = formatRuntime(item.RunTimeTicks);
  const resumeTicks = item.UserData?.PlaybackPositionTicks ?? 0;
  const isVideo = item.MediaType === 'Video' || item.Type === 'Movie' || item.Type === 'Episode';
  const isAlbum = item.Type === 'MusicAlbum';
  const showPlay = canPlay && (isVideo || item.Type === 'Series');
  const showMusicPlay = canPlay && isAlbum && musicQueue.length > 0;

  return (
    <div className="animate-content-in space-y-4 px-2 py-3">
      <div className="flex items-center gap-1">
        <Link
          href="/jellyfin/library"
          aria-label="Back to library"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-colors hover:bg-accent"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{item.Name}</h1>
      </div>

      <div className="flex gap-4">
        <div className="w-32 shrink-0 sm:w-40">
          <div
            className={`relative ${isAlbum ? 'aspect-square' : 'aspect-[2/3]'} overflow-hidden rounded-lg border bg-muted/40`}
          >
            {!posterFailed && (
              // eslint-disable-next-line @next/next/no-img-element -- proxied, size-capped upstream
              <img
                src={`/api/jellyfin/image?itemId=${item.Id}&type=Primary&maxWidth=400`}
                alt=""
                className="h-full w-full object-cover"
                onError={() => setPosterFailed(true)}
              />
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {item.ProductionYear && <span>{item.ProductionYear}</span>}
            {runtime && <span>{runtime}</span>}
            {item.OfficialRating && (
              <span className="rounded border px-1 py-0.5 text-[10px]">{item.OfficialRating}</span>
            )}
            {item.CommunityRating !== undefined && (
              <span className="flex items-center gap-0.5">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden />
                {item.CommunityRating.toFixed(1)}
              </span>
            )}
            {item.UserData?.Played && (
              <span className="flex items-center gap-1 text-primary">
                <Check className="h-3 w-3" aria-hidden />
                Watched
              </span>
            )}
          </div>
          {isAlbum && item.AlbumArtist && (
            <p className="text-sm text-muted-foreground">{item.AlbumArtist}</p>
          )}
          {item.Genres && item.Genres.length > 0 && (
            <p className="text-xs text-muted-foreground">{item.Genres.slice(0, 4).join(' · ')}</p>
          )}
          {showMusicPlay && (
            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              <Button
                onClick={() => useMusicStore.getState().playQueue(musicQueue)}
                className="h-10 rounded-full sm:flex-1"
              >
                <Play className="mr-2 h-4 w-4 fill-current" />
                Play
              </Button>
              <Button
                variant="secondary"
                onClick={() => useMusicStore.getState().playShuffled(musicQueue)}
                className="h-10 rounded-full sm:flex-1"
              >
                <Shuffle className="mr-2 h-4 w-4" />
                Shuffle
              </Button>
            </div>
          )}
          {showPlay && (
            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              {item.Type === 'Series' ? (
                <Button onClick={playSeries} disabled={playLoading} className="h-10 rounded-full sm:flex-1">
                  {playLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4 fill-current" />
                  )}
                  Play
                </Button>
              ) : resumeTicks > 0 ? (
                <>
                  <Button
                    onClick={() => router.push(`/watch/${item.Id}?t=${resumeTicks}`)}
                    className="h-10 rounded-full sm:flex-1"
                  >
                    <Play className="mr-2 h-4 w-4 fill-current" />
                    Resume
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => router.push(`/watch/${item.Id}?t=0`)}
                    className="h-10 rounded-full sm:flex-1"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    From beginning
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() => router.push(`/watch/${item.Id}`)}
                  className="h-10 rounded-full sm:flex-1"
                >
                  <Play className="mr-2 h-4 w-4 fill-current" />
                  Play
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {item.Overview && (
        <p className="text-sm leading-relaxed text-muted-foreground">{item.Overview}</p>
      )}

      {isAlbum &&
        (tracks === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : tracks.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">This album has no tracks.</p>
        ) : (
          <div className="space-y-0.5">
            {tracks.map((track, i) => (
              <TrackRow
                key={track.Id}
                track={track}
                position={i + 1}
                canPlay={canPlay}
                onPlay={() => useMusicStore.getState().playQueue(musicQueue, i)}
                onEnqueue={() => {
                  useMusicStore.getState().enqueue([musicQueue[i]]);
                  toast.success(`Added “${track.Name}” to queue`);
                }}
              />
            ))}
          </div>
        ))}

      {item.Type === 'Series' &&
        (seasons === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : (
          <div>
            {seasons.map(([seasonName, seasonEpisodes]) => (
              <SeasonAccordion
                key={seasonName}
                name={seasonName}
                episodes={seasonEpisodes}
                expanded={effectiveExpanded.has(seasonName)}
                canPlay={canPlay}
                onToggle={() => toggleSeason(seasonName)}
                onPlay={playEpisode}
              />
            ))}
          </div>
        ))}
    </div>
  );
}
