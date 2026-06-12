'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Disc3,
  Film,
  FolderOpen,
  LibraryBig,
  ListVideo,
  Tv,
  type LucideIcon,
} from 'lucide-react';
import { PageSpinner } from '@/components/ui/page-spinner';
import type { JellyfinLibrary } from '@/types/jellyfin';

const COLLECTION_ICONS: Record<string, LucideIcon> = {
  movies: Film,
  tvshows: Tv,
  music: Disc3,
  boxsets: FolderOpen,
  playlists: ListVideo,
};

function ViewCard({ view }: { view: JellyfinLibrary }) {
  const [imgFailed, setImgFailed] = useState(false);
  const Icon = COLLECTION_ICONS[view.CollectionType ?? ''] ?? LibraryBig;
  return (
    <Link
      href={`/jellyfin/library/${view.Id}`}
      className="group relative block aspect-video overflow-hidden rounded-xl border bg-muted/40"
    >
      {!imgFailed && (
        // eslint-disable-next-line @next/next/no-img-element -- proxied, size-capped upstream
        <img
          src={`/api/jellyfin/image?itemId=${view.Id}&type=Primary&maxWidth=600`}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      {imgFailed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon className="h-10 w-10 text-muted-foreground/60" aria-hidden />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-3">
        <Icon className="h-4 w-4 shrink-0 text-white/80" aria-hidden />
        <span className="truncate text-sm font-semibold text-white">{view.Name}</span>
      </div>
    </Link>
  );
}

export default function JellyfinLibraryPage() {
  const [views, setViews] = useState<JellyfinLibrary[] | null>(null);
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
    return () => {
      cancelled = true;
    };
  }, []);

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
    <div className="animate-content-in space-y-3 px-2 py-3">
      <h1 className="text-xl font-bold">Library</h1>
      {views.length === 0 ? (
        <p className="text-sm text-muted-foreground">No libraries are visible to your account.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {views.map((view) => (
            <ViewCard key={view.Id} view={view} />
          ))}
        </div>
      )}
    </div>
  );
}
