'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles, Pencil, Plus, Loader2, AlertTriangle } from 'lucide-react';
import { AnilistStatusDrawer } from '@/components/anime/anilist-status-drawer';
import type { AniListMediaListEntryBase, AniListMediaListStatus } from '@/lib/anilist-mutations';

interface ViewerSummary {
  configured: boolean;
  connected: boolean | null;
  requiresReauth: boolean;
  transientError?: boolean;
  user?: {
    scoreFormat: string | null;
  };
}

interface AnilistStatusPanelProps {
  mediaId: number;
  mediaTitle: string;
  mediaType: 'ANIME' | 'MANGA';
  totalEpisodes?: number | null;
  totalChapters?: number | null;
  totalVolumes?: number | null;
}

const STATUS_LABELS_ANIME: Record<AniListMediaListStatus, string> = {
  CURRENT: 'Watching',
  PLANNING: 'Planning',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
  REPEATING: 'Repeating',
};

const STATUS_LABELS_MANGA: Record<AniListMediaListStatus, string> = {
  CURRENT: 'Reading',
  PLANNING: 'Planning',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
  REPEATING: 'Re-reading',
};

const STATUS_COLORS: Record<AniListMediaListStatus, string> = {
  CURRENT: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  PLANNING: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  COMPLETED: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  PAUSED: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  DROPPED: 'bg-red-500/20 text-red-300 border-red-500/30',
  REPEATING: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
};

export function AnilistStatusPanel({
  mediaId,
  mediaTitle,
  mediaType,
  totalEpisodes,
  totalChapters,
  totalVolumes,
}: AnilistStatusPanelProps) {
  const [viewer, setViewer] = useState<ViewerSummary | null>(null);
  const [entry, setEntry] = useState<AniListMediaListEntryBase | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadEntry = useCallback(async (viewData: ViewerSummary) => {
    try {
      const res = await fetch(`/api/anilist/list-entry?mediaId=${mediaId}`);
      if (res.status === 401) {
        setViewer((prev) => prev ? { ...prev, connected: false, requiresReauth: true } : { configured: true, connected: false, requiresReauth: true });
        return;
      }
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const data = await res.json();
      setLoadError(false);
      const entry = data?.entry ?? null;
      if (entry && viewData?.user?.scoreFormat === "POINT_10_DECIMAL" && entry.score != null && entry.score > 10) {
        setEntry({ ...entry, score: entry.score / 10 });
      } else {
        setEntry(entry);
      }
    } catch {
      setLoadError(true);
    }
  }, [mediaId]);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      try {
        const res = await fetch('/api/anilist/viewer');
        if (!res.ok) {
          if (!cancelled) setViewer({ configured: false, connected: false, requiresReauth: false });
          return;
        }
        const data: ViewerSummary = await res.json();
        if (cancelled) return;
        setViewer(data);
        if (data.connected) {
          await loadEntry(data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [loadEntry]);

  if (loading) {
    return (
      <div className="rounded-lg border border-dashed border-border/40 bg-muted/10 px-5 py-4 flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!viewer?.connected) {
    return (
      <Link
        href="/settings"
        className="group relative flex items-center justify-between gap-4 rounded-lg border border-dashed border-pink-500/30 bg-pink-500/5 px-5 py-3 hover:bg-pink-500/10 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pink-500/20 text-pink-400 shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="tracked-caps text-pink-300/80">AniList</p>
            <p className="text-sm font-medium leading-tight">
              {viewer?.requiresReauth ? 'Reconnect to track this' : 'Track on AniList'}
            </p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">Settings →</span>
      </Link>
    );
  }

  const labels = mediaType === 'MANGA' ? STATUS_LABELS_MANGA : STATUS_LABELS_ANIME;
  const total = mediaType === 'MANGA' ? totalChapters : totalEpisodes;
  const loadErrorBanner = loadError ? (
    <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200 flex items-center gap-2">
      <AlertTriangle className="h-3.5 w-3.5" />
      AniList status is temporarily unavailable.
    </div>
  ) : null;

  if (!entry) {
    return (
      <>
        {loadErrorBanner}
        <button
          onClick={() => setDrawerOpen(true)}
          className="group relative w-full flex items-center justify-between gap-4 rounded-lg border border-pink-500/30 bg-pink-500/10 px-5 py-3 hover:bg-pink-500/20 transition-colors press-feedback"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pink-500/30 text-pink-300 shrink-0">
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
            <div className="min-w-0 text-left">
              <p className="tracked-caps text-pink-300/80">AniList</p>
              <p className="text-sm font-medium leading-tight">Add to AniList list</p>
            </div>
          </div>
          <Sparkles className="h-4 w-4 text-pink-300/80" />
        </button>
        <AnilistStatusDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          mediaId={mediaId}
          mediaTitle={mediaTitle}
          mediaType={mediaType}
          totalEpisodes={totalEpisodes}
          totalChapters={totalChapters}
          totalVolumes={totalVolumes}
          entry={null}
          scoreFormat={viewer.user?.scoreFormat ?? null}
          onSaved={(saved) => setEntry(saved)}
          onDeleted={() => setEntry(null)}
        />
      </>
    );
  }

  const statusBadge = STATUS_COLORS[entry.status];
  const progressLabel = total != null ? `${entry.progress} / ${total}` : `${entry.progress}`;

  return (
    <>
      {loadErrorBanner}
      <button
        onClick={() => setDrawerOpen(true)}
        className="group relative w-full flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-card/40 backdrop-blur-sm px-5 py-3 hover:border-pink-500/40 hover:bg-pink-500/5 transition-colors press-feedback"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pink-500/15 text-pink-300 shrink-0">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 text-left flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${statusBadge}`}>
                {labels[entry.status]}
              </span>
              <span className="text-xs text-muted-foreground">{progressLabel}{entry.score > 0 ? ` · ${entry.score}/10` : ''}</span>
            </div>
            <span className="text-sm font-medium leading-tight">On your AniList</span>
          </div>
        </div>
        <Pencil className="h-4 w-4 text-muted-foreground" />
      </button>
      <AnilistStatusDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mediaId={mediaId}
        mediaTitle={mediaTitle}
        mediaType={mediaType}
        totalEpisodes={totalEpisodes}
        totalChapters={totalChapters}
        totalVolumes={totalVolumes}
        entry={entry}
        scoreFormat={viewer.user?.scoreFormat ?? null}
        onSaved={(saved) => setEntry(saved)}
        onDeleted={() => setEntry(null)}
      />
    </>
  );
}
