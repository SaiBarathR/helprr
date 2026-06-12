'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Disc3,
  Film,
  FolderOpen,
  Info,
  LibraryBig,
  ListVideo,
  Play,
  Tv,
  type LucideIcon,
} from 'lucide-react';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Button } from '@/components/ui/button';
import { useCan } from '@/components/permission-provider';
import type { JellyfinItem, JellyfinLibrary } from '@/types/jellyfin';

/** Top-level item type to list per collection type for "Recently added" rails. */
const RECENT_ITEM_TYPES: Record<string, string> = {
  movies: 'Movie',
  tvshows: 'Series',
  music: 'MusicAlbum',
};

const COLLECTION_ICONS: Record<string, LucideIcon> = {
  movies: Film,
  tvshows: Tv,
  music: Disc3,
  boxsets: FolderOpen,
  playlists: ListVideo,
};

function imageUrl(itemId: string, type: 'Primary' | 'Backdrop', maxWidth: number): string {
  return `/api/jellyfin/image?itemId=${itemId}&type=${type}&maxWidth=${maxWidth}`;
}

function episodeCode(item: JellyfinItem): string | null {
  return item.ParentIndexNumber !== undefined && item.IndexNumber !== undefined
    ? `S${item.ParentIndexNumber}:E${item.IndexNumber}`
    : null;
}

/** Img that walks a fallback chain (e.g. Backdrop → Primary) before giving up. */
function FallbackImage({ sources, className }: { sources: string[]; className: string }) {
  const [index, setIndex] = useState(0);
  if (index >= sources.length) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- proxied, size-capped upstream
    <img
      src={sources[index]}
      alt=""
      className={className}
      loading="lazy"
      onError={() => setIndex((i) => i + 1)}
    />
  );
}

function Rail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-0.5 text-base font-semibold">{title}</h2>
      <div className="flex gap-2.5 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-hide">
        {children}
      </div>
    </section>
  );
}

function Hero({
  item,
  canPlay,
  onPlay,
  onOpen,
}: {
  item: JellyfinItem;
  canPlay: boolean;
  onPlay: (item: JellyfinItem) => void;
  onOpen: (item: JellyfinItem) => void;
}) {
  const backdropId = item.Type === 'Episode' ? item.SeriesId ?? item.Id : item.Id;
  const playable = item.MediaType === 'Video' || item.Type === 'Movie' || item.Type === 'Episode';
  const progress = item.UserData?.PlayedPercentage;
  const code = episodeCode(item);
  const meta = [
    item.Type === 'Episode' ? item.SeriesName : null,
    code,
    item.ProductionYear?.toString(),
  ].filter(Boolean);

  return (
    <section className="relative overflow-hidden rounded-2xl border bg-muted/40">
      <div className="relative aspect-[16/9] w-full sm:aspect-[21/9]">
        <FallbackImage
          sources={[imageUrl(backdropId, 'Backdrop', 1280), imageUrl(backdropId, 'Primary', 1280)]}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 space-y-2 p-4 sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">
            {progress !== undefined && progress > 0 ? 'Continue watching' : 'Recently added'}
          </p>
          <h1 className="line-clamp-2 text-xl font-bold text-white sm:text-2xl">{item.Name}</h1>
          {meta.length > 0 && (
            <p className="truncate text-xs text-white/70">{meta.join(' · ')}</p>
          )}
          <div className="flex items-center gap-2 pt-1">
            {canPlay && playable && (
              <Button onClick={() => onPlay(item)} className="h-9 rounded-full px-5">
                <Play className="mr-2 h-4 w-4 fill-current" />
                {progress !== undefined && progress > 0 ? 'Resume' : 'Play'}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => onOpen(item)}
              className="h-9 rounded-full bg-white/15 px-5 text-white hover:bg-white/25"
            >
              <Info className="mr-2 h-4 w-4" />
              Details
            </Button>
          </div>
        </div>
        {progress !== undefined && progress > 0 && progress < 100 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    </section>
  );
}

function ResumeCard({ item, onSelect }: { item: JellyfinItem; onSelect: () => void }) {
  const progress = item.UserData?.PlayedPercentage ?? 0;
  const code = episodeCode(item);
  const subtitle =
    item.Type === 'Episode'
      ? [item.SeriesName, code].filter(Boolean).join(' · ')
      : item.ProductionYear?.toString();
  // Episode Primary is a landscape still; movies look better with their backdrop.
  const sources =
    item.Type === 'Episode'
      ? [imageUrl(item.Id, 'Primary', 480)]
      : [imageUrl(item.Id, 'Backdrop', 480), imageUrl(item.Id, 'Primary', 480)];
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative w-60 min-w-[15rem] snap-start overflow-hidden rounded-xl border bg-muted/40 text-left"
    >
      <div className="relative aspect-video">
        <FallbackImage
          sources={sources}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <Play className="h-8 w-8 fill-white text-white" aria-hidden />
        </div>
        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <p className="truncate text-xs font-semibold text-white">{item.Name}</p>
          {subtitle && <p className="truncate text-[11px] text-white/60">{subtitle}</p>}
        </div>
        {progress > 0 && progress < 100 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    </button>
  );
}

function PosterCard({
  item,
  square,
  onSelect,
}: {
  item: JellyfinItem;
  /** Square artwork (music albums) instead of a 2:3 poster. */
  square?: boolean;
  onSelect: () => void;
}) {
  // A lone new episode arrives ungrouped — show it as its series, not a still frame.
  const isEpisode = item.Type === 'Episode';
  const posterId = isEpisode ? item.SeriesId ?? item.Id : item.Id;
  const title = isEpisode ? item.SeriesName ?? item.Name : item.Name;
  const subtitle = isEpisode
    ? episodeCode(item)
    : item.AlbumArtist ?? item.ProductionYear?.toString();
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group w-32 min-w-[8rem] snap-start text-left sm:w-36 sm:min-w-[9rem]"
    >
      <div
        className={`relative ${square ? 'aspect-square' : 'aspect-[2/3]'} overflow-hidden rounded-xl border bg-muted/40`}
      >
        <FallbackImage
          sources={[imageUrl(posterId, 'Primary', 400)]}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-2">
          <p className="line-clamp-2 text-xs font-medium leading-tight text-white">{title}</p>
          <p className="mt-0.5 truncate text-[10px] text-white/70">{subtitle ?? ''}</p>
        </div>
      </div>
    </button>
  );
}

function ViewCard({ view }: { view: JellyfinLibrary }) {
  const Icon = COLLECTION_ICONS[view.CollectionType ?? ''] ?? LibraryBig;
  return (
    <Link
      href={`/jellyfin/library/${view.Id}`}
      className="group relative block aspect-video w-56 min-w-[14rem] snap-start overflow-hidden rounded-xl border bg-muted/40"
    >
      <FallbackImage
        sources={[imageUrl(view.Id, 'Primary', 600)]}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-3">
        <Icon className="h-4 w-4 shrink-0 text-white/80" aria-hidden />
        <span className="truncate text-sm font-semibold text-white">{view.Name}</span>
      </div>
    </Link>
  );
}

export default function JellyfinLibraryPage() {
  const router = useRouter();
  const canPlay = useCan('jellyfin.play');
  const [views, setViews] = useState<JellyfinLibrary[] | null>(null);
  const [resume, setResume] = useState<JellyfinItem[]>([]);
  const [latest, setLatest] = useState<Record<string, JellyfinItem[]>>({});
  const [recentByLib, setRecentByLib] = useState<Record<string, JellyfinItem[]>>({});
  const [linked, setLinked] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/jellyfin/views')
      .then(async (res) => {
        const data = (await res.json()) as {
          views?: JellyfinLibrary[];
          linked?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? 'Failed to load libraries');
          return;
        }
        setLinked(data.linked ?? true);
        setViews(data.views ?? []);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load libraries');
      });
    fetch('/api/jellyfin/resume?limit=12')
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { items?: JellyfinItem[] };
        if (!cancelled) setResume(data.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!views) return;
    let cancelled = false;
    // Collections and playlists have no meaningful "latest" — Jellyfin skips them too.
    views
      .filter((view) => !['boxsets', 'playlists'].includes(view.CollectionType ?? ''))
      .forEach((view) => {
        fetch(`/api/jellyfin/recently-added?limit=16&parentId=${view.Id}`)
          .then(async (res) => {
            if (!res.ok) return;
            const data = (await res.json()) as { items?: JellyfinItem[] };
            if (!cancelled && data.items && data.items.length > 0) {
              const items = data.items;
              setLatest((prev) => ({ ...prev, [view.Id]: items }));
            }
          })
          .catch(() => {});
        // "Latest" shows new episodes/items; "Recently added" shows the
        // newest top-level entries (movies, series, albums) by date added.
        const itemType = RECENT_ITEM_TYPES[view.CollectionType ?? ''];
        if (!itemType) return;
        fetch(
          `/api/jellyfin/items?parentId=${view.Id}&includeItemTypes=${itemType}&sortBy=DateCreated&sortOrder=Descending&limit=16`
        )
          .then(async (res) => {
            if (!res.ok) return;
            const data = (await res.json()) as { items?: JellyfinItem[] };
            if (!cancelled && data.items && data.items.length > 0) {
              const items = data.items;
              setRecentByLib((prev) => ({ ...prev, [view.Id]: items }));
            }
          })
          .catch(() => {});
      });
    return () => {
      cancelled = true;
    };
  }, [views]);

  const playItem = (item: JellyfinItem) => {
    router.push(`/watch/${item.Id}`);
  };
  const openItem = (item: JellyfinItem) => {
    // New episodes open their series page (season list) rather than a bare episode.
    const id = item.Type === 'Episode' && item.SeriesId ? item.SeriesId : item.Id;
    router.push(`/jellyfin/library/item/${id}`);
  };

  const hero = useMemo(() => {
    if (resume[0]) return resume[0];
    for (const view of views ?? []) {
      const first = latest[view.Id]?.[0];
      if (first) return first;
    }
    return null;
  }, [resume, views, latest]);
  // The hero already features the first resume item — don't repeat it in the rail.
  const resumeRail = useMemo(
    () => (hero && resume[0]?.Id === hero.Id ? resume.slice(1) : resume),
    [hero, resume]
  );

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  }
  if (views === null) return <PageSpinner />;
  if (!linked) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        Your Helprr account isn&apos;t linked to a Jellyfin user. Ask your admin to link it.
      </div>
    );
  }

  return (
    <div className="animate-content-in space-y-5 px-2 py-3">
      {hero ? (
        <Hero item={hero} canPlay={canPlay} onPlay={playItem} onOpen={openItem} />
      ) : (
        <h1 className="text-xl font-bold">Library</h1>
      )}

      {resumeRail.length > 0 && (
        <Rail title="Continue watching">
          {resumeRail.map((item) => (
            <ResumeCard
              key={item.Id}
              item={item}
              onSelect={() => (canPlay ? playItem(item) : openItem(item))}
            />
          ))}
        </Rail>
      )}

      {views.map((view) => {
        const square = view.CollectionType === 'music';
        return (
          <Fragment key={view.Id}>
            {(latest[view.Id]?.length ?? 0) > 0 && (
              <Rail title={`Latest ${view.Name}`}>
                {latest[view.Id].map((item) => (
                  <PosterCard
                    key={item.Id}
                    item={item}
                    square={square}
                    onSelect={() => openItem(item)}
                  />
                ))}
              </Rail>
            )}
            {(recentByLib[view.Id]?.length ?? 0) > 0 && (
              <Rail title={`Recently added ${view.Name}`}>
                {recentByLib[view.Id].map((item) => (
                  <PosterCard
                    key={item.Id}
                    item={item}
                    square={square}
                    onSelect={() => openItem(item)}
                  />
                ))}
              </Rail>
            )}
          </Fragment>
        );
      })}

      {views.length === 0 ? (
        <p className="text-sm text-muted-foreground">No libraries are visible to your account.</p>
      ) : (
        <Rail title="My libraries">
          {views.map((view) => (
            <ViewCard key={view.Id} view={view} />
          ))}
        </Rail>
      )}
    </div>
  );
}
