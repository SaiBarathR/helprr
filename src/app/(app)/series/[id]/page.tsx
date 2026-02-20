'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
  DrawerDescription, DrawerFooter, DrawerClose,
} from '@/components/ui/drawer';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/layout/page-header';
import { getImageUrl } from '@/components/media/media-card';
import {
  Bookmark, MoreHorizontal, RefreshCw, Search, ExternalLink,
  Pencil, Trash2, Loader2, Tv, ChevronRight, Heart, Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { SonarrSeries, SonarrEpisode, QualityProfile, RootFolder, Tag } from '@/types';

export default function SeriesDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [series, setSeries] = useState<SonarrSeries | null>(null);
  const [episodes, setEpisodes] = useState<SonarrEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [showMonitorEdit, setShowMonitorEdit] = useState(false);
  const [monitorOption, setMonitorOption] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [overviewExpanded, setOverviewExpanded] = useState(false);

  const MONITOR_OPTIONS = [
    { value: 'all', label: 'All Episodes' },
    { value: 'future', label: 'Future Episodes' },
    { value: 'missing', label: 'Missing Episodes' },
    { value: 'existing', label: 'Existing Episodes' },
    { value: 'recent', label: 'Recent Episodes' },
    { value: 'pilot', label: 'Pilot Episode' },
    { value: 'firstSeason', label: 'First Season' },
    { value: 'lastSeason', label: 'Last Season' },
    { value: 'monitorSpecials', label: 'Monitor Specials' },
    { value: 'unmonitorSpecials', label: 'Unmonitor Specials' },
    { value: 'none', label: 'None' },
  ];

  // Reference data
  const [qualityProfiles, setQualityProfiles] = useState<QualityProfile[]>([]);
  const [rootFolders, setRootFolders] = useState<RootFolder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/sonarr/${id}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/sonarr/${id}/episodes`).then((r) => r.ok ? r.json() : []),
      fetch('/api/sonarr/qualityprofiles').then((r) => r.ok ? r.json() : []),
      fetch('/api/sonarr/rootfolders').then((r) => r.ok ? r.json() : []),
      fetch('/api/sonarr/tags').then((r) => r.ok ? r.json() : []),
    ])
      .then(([s, e, qp, rf, t]) => {
        setSeries(s);
        setEpisodes(e);
        setQualityProfiles(qp);
        setRootFolders(rf);
        setTags(t);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const seasonNumbers = [...new Set(episodes.map((e) => e.seasonNumber))].sort((a, b) => b - a);

  async function handleSearchAll() {
    if (!series) return;
    setActionLoading('search');
    try {
      await fetch('/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SeriesSearch', seriesId: series.id }),
      });
      toast.success('Series search started');
    } catch { toast.error('Search failed'); }
    finally { setActionLoading(''); }
  }

  async function handleToggleMonitored() {
    if (!series) return;
    setActionLoading('monitor');
    try {
      const res = await fetch(`/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...series, monitored: !series.monitored }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSeries(updated);
        toast.success(updated.monitored ? 'Now monitored' : 'Unmonitored');
      }
    } catch { toast.error('Failed to update'); }
    finally { setActionLoading(''); }
  }

  async function handleToggleSeasonMonitor(seasonNumber: number, monitored: boolean) {
    if (!series) return;
    try {
      const updatedSeries = {
        ...series,
        seasons: series.seasons.map((s) =>
          s.seasonNumber === seasonNumber ? { ...s, monitored } : s
        ),
      };
      const res = await fetch(`/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSeries),
      });
      if (res.ok) {
        const updated = await res.json();
        setSeries(updated);
        toast.success(`Season ${seasonNumber} ${monitored ? 'monitored' : 'unmonitored'}`);
      }
    } catch { toast.error('Failed to update season'); }
  }

  async function handleApplyMonitor() {
    if (!series || !monitorOption) return;
    setActionLoading('applyMonitor');
    try {
      const res = await fetch('/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'MonitoredEpisodeCommand' in {} ? 'MonitoredEpisodeCommand' : 'RefreshSeries',
          seriesId: series.id,
        }),
      });
      // Update series monitored state via PUT
      const monitorUpdate = {
        ...series,
        monitored: monitorOption !== 'none',
        seasons: series.seasons.map((s) => {
          switch (monitorOption) {
            case 'all':
              return { ...s, monitored: true };
            case 'future':
              return { ...s, monitored: true };
            case 'none':
              return { ...s, monitored: false };
            case 'firstSeason':
              return { ...s, monitored: s.seasonNumber === 1 };
            case 'lastSeason': {
              const maxSeason = Math.max(...series.seasons.filter((ss) => ss.seasonNumber > 0).map((ss) => ss.seasonNumber));
              return { ...s, monitored: s.seasonNumber === maxSeason };
            }
            case 'monitorSpecials':
              return { ...s, monitored: true };
            case 'unmonitorSpecials':
              return { ...s, monitored: s.seasonNumber !== 0 ? s.monitored : false };
            default:
              return { ...s, monitored: true };
          }
        }),
        addOptions: { monitor: monitorOption },
      };
      const updateRes = await fetch(`/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(monitorUpdate),
      });
      if (updateRes.ok) {
        const updated = await updateRes.json();
        setSeries(updated);
        toast.success(`Monitor set to: ${MONITOR_OPTIONS.find((o) => o.value === monitorOption)?.label}`);
        setShowMonitorEdit(false);
      } else {
        toast.error('Failed to update monitor');
      }
    } catch { toast.error('Failed to update monitor'); }
    finally { setActionLoading(''); }
  }

  async function handleRefresh() {
    if (!series) return;
    setActionLoading('refresh');
    try {
      await fetch('/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'RefreshSeries', seriesId: series.id }),
      });
      toast.success('Refresh started');
    } catch { toast.error('Refresh failed'); }
    finally { setActionLoading(''); }
  }

  async function handleDelete() {
    if (!series) return;
    setDeleting(true);
    try {
      await fetch(`/api/sonarr/${series.id}?deleteFiles=true`, { method: 'DELETE' });
      toast.success('Series deleted');
      router.push('/series');
    } catch { toast.error('Delete failed'); }
    finally { setDeleting(false); }
  }

  // Loading skeleton
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <div className="flex gap-4 px-4">
          <Skeleton className="h-40 w-28 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2 pt-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <div className="space-y-2 px-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="space-y-1 px-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!series) {
    return <div className="text-center py-12 text-muted-foreground">Series not found</div>;
  }

  const poster = getImageUrl(series.images, 'poster');
  const qualityProfile = qualityProfiles.find((qp) => qp.id === series.qualityProfileId);
  const seriesTags = tags.filter((t) => series.tags.includes(t.id));
  const rootFolder = rootFolders.find((rf) => series.path?.startsWith(rf.path));

  // Determine status badge
  const hasAllFiles = series.statistics
    ? series.statistics.episodeFileCount >= series.statistics.episodeCount && series.statistics.episodeCount > 0
    : false;
  const statusLabel = hasAllFiles ? 'DOWNLOADED' : series.status?.toUpperCase() || 'UNKNOWN';
  const statusColor = hasAllFiles
    ? 'bg-green-500/20 text-green-400'
    : series.status === 'continuing'
      ? 'bg-purple-500/20 text-purple-400'
      : 'bg-muted text-muted-foreground';

  // Next airing
  const nextAiring = series.nextAiring
    ? format(new Date(series.nextAiring), "MMM d, yyyy 'at' h:mm a")
    : null;

  return (
    <div className="flex flex-col min-h-0">
      {/* Page Header */}
      <PageHeader
        title={series.title}
        rightContent={
          <div className="flex items-center gap-0.5">
            {/* Bookmark / Monitor toggle */}
            <button
              onClick={handleToggleMonitored}
              disabled={actionLoading === 'monitor'}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary"
            >
              {actionLoading === 'monitor' ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : series.monitored ? (
                <Bookmark className="h-5 w-5 fill-current" />
              ) : (
                <Bookmark className="h-5 w-5" />
              )}
            </button>

            {/* 3-dot dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary">
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={handleRefresh} disabled={actionLoading === 'refresh'}>
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSearchAll} disabled={actionLoading === 'search'}>
                  <Search className="h-4 w-4" />
                  Search Monitored
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {series.tvdbId > 0 && (
                  <DropdownMenuItem asChild>
                    <a href={`https://trakt.tv/search/tvdb/${series.tvdbId}?id_type=show`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      Open in Trakt
                    </a>
                  </DropdownMenuItem>
                )}
                {series.imdbId && (
                  <DropdownMenuItem asChild>
                    <a href={`https://www.imdb.com/title/${series.imdbId}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      Open in IMDb
                    </a>
                  </DropdownMenuItem>
                )}
                {series.tvdbId > 0 && (
                  <DropdownMenuItem asChild>
                    <a href={`https://www.thetvdb.com/?id=${series.tvdbId}&tab=series`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      Open in TVDB
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowMonitorEdit(true)}>
                  <Eye className="h-4 w-4" />
                  Monitor
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push(`/series/${id}/edit`)}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setShowDelete(true)}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {/* Hero: Poster + Title area */}
        <div className="flex gap-4 px-4 pt-3 pb-4">
          {/* Poster */}
          <div className="w-28 shrink-0">
            {poster ? (
              <Image
                src={poster}
                alt={series.title}
                width={112}
                height={168}
                className="w-full h-auto aspect-[2/3] object-cover rounded-lg"
              />
            ) : (
              <div className="w-full aspect-[2/3] rounded-lg bg-muted flex items-center justify-center">
                <Tv className="h-10 w-10 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Title & meta */}
          <div className="flex-1 min-w-0 pt-1">
            <span className={`inline-block text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded ${statusColor} mb-1.5`}>
              {statusLabel}
            </span>
            <h1 className="text-lg font-bold leading-tight">{series.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {series.year}
              {series.runtime > 0 && <> &middot; {series.runtime}m</>}
              {series.certification && <> &middot; {series.certification}</>}
            </p>
            {series.ratings && series.ratings.value > 0 && (
              <div className="flex items-center gap-1 mt-1.5">
                <Heart className="h-3.5 w-3.5 text-red-500 fill-red-500" />
                <span className="text-sm font-medium">{Math.round(series.ratings.value * 10)}%</span>
              </div>
            )}
          </div>
        </div>

        {/* Borderless metadata rows */}
        <div className="px-4 space-y-0">
          <div className="flex py-2 border-b border-border/30">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider w-20 shrink-0 pt-0.5">Status</span>
            <span className="text-sm capitalize">{series.status}</span>
          </div>
          {series.network && (
            <div className="flex py-2 border-b border-border/30">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider w-20 shrink-0 pt-0.5">Network</span>
              <span className="text-sm">{series.network}</span>
            </div>
          )}
          {series.genres && series.genres.length > 0 && (
            <div className="flex py-2 border-b border-border/30">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider w-20 shrink-0 pt-0.5">Genre</span>
              <span className="text-sm">{series.genres.join(', ')}</span>
            </div>
          )}
          {nextAiring && (
            <div className="flex py-2 border-b border-border/30">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider w-20 shrink-0 pt-0.5">Airing</span>
              <span className="text-sm">{nextAiring}</span>
            </div>
          )}
        </div>

        {/* Overview */}
        {series.overview && (
          <div className="px-4 pt-4 pb-2">
            <p
              className={`text-sm text-muted-foreground leading-relaxed ${
                !overviewExpanded ? 'line-clamp-3' : ''
              }`}
            >
              {series.overview}
            </p>
            {series.overview.length > 150 && (
              <button
                onClick={() => setOverviewExpanded(!overviewExpanded)}
                className="text-sm text-primary mt-1"
              >
                {overviewExpanded ? 'Show less' : 'More...'}
              </button>
            )}
          </div>
        )}

        {/* Seasons list */}
        <div className="mt-4 px-4">
          <h2 className="text-lg font-bold mb-2">Seasons</h2>
          <div>
            {seasonNumbers.map((sn) => {
              const seasonEps = episodes.filter((e) => e.seasonNumber === sn);
              const fileCount = seasonEps.filter((e) => e.hasFile).length;
              const total = seasonEps.length;
              const seasonData = series.seasons.find((s) => s.seasonNumber === sn);
              const isMonitored = seasonData?.monitored ?? true;

              return (
                <Link
                  key={sn}
                  href={`/series/${id}/season/${sn}`}
                  className="flex items-center py-3.5 border-b border-border/50"
                >
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{sn === 0 ? 'Specials' : `Season ${sn}`}</span>
                    <span className="ml-2 text-sm text-muted-foreground">{fileCount}/{total}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleToggleSeasonMonitor(sn, !isMonitored);
                    }}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center"
                  >
                    {isMonitored ? (
                      <Bookmark className="h-5 w-5 fill-current text-foreground" />
                    ) : (
                      <Bookmark className="h-5 w-5 text-muted-foreground" />
                    )}
                  </button>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Information section */}
        <div className="mt-6 px-4 pb-8">
          <h2 className="text-lg font-bold mb-2">Information</h2>
          <div className="space-y-0">
            <div className="flex justify-between py-2.5 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Quality Profile</span>
              <span className="text-sm">{qualityProfile?.name || 'Unknown'}</span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Series Type</span>
              <span className="text-sm capitalize">{series.seriesType}</span>
            </div>
            {seriesTags.length > 0 && (
              <div className="flex justify-between py-2.5 border-b border-border/30">
                <span className="text-sm text-muted-foreground">Tags</span>
                <span className="text-sm">{seriesTags.map((t) => t.label).join(', ')}</span>
              </div>
            )}
            {rootFolder && (
              <div className="flex justify-between py-2.5 border-b border-border/30">
                <span className="text-sm text-muted-foreground shrink-0">Root Folder</span>
                <span className="text-sm text-right truncate ml-4">{rootFolder.path}</span>
              </div>
            )}
            <div className="flex justify-between py-2.5 border-b border-border/30">
              <span className="text-sm text-muted-foreground">New Seasons</span>
              <span className="text-sm">{series.monitored ? 'Monitored' : 'Not Monitored'}</span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Season Folders</span>
              <span className="text-sm">{series.seasonFolder ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Added</span>
              <span className="text-sm">
                {series.added ? format(new Date(series.added), 'MMM d, yyyy') : 'Unknown'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Monitor edit drawer */}
      <Drawer open={showMonitorEdit} onOpenChange={setShowMonitorEdit}>
        <DrawerContent>
          <DrawerHeader className="text-center">
            <DrawerTitle>Monitor</DrawerTitle>
            <DrawerDescription>
              Choose which episodes to monitor for {series.title}.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-2">
            <div className="grouped-section">
              <div className="grouped-section-content">
                {MONITOR_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setMonitorOption(option.value)}
                    className={`grouped-row w-full text-left active:bg-white/5 transition-colors ${
                      monitorOption === option.value ? 'text-primary' : ''
                    }`}
                  >
                    <span className="text-sm">{option.label}</span>
                    {monitorOption === option.value && (
                      <span className="text-primary text-sm font-medium">&#10003;</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DrawerFooter>
            <Button
              onClick={handleApplyMonitor}
              disabled={!monitorOption || actionLoading === 'applyMonitor'}
              className="w-full"
            >
              {actionLoading === 'applyMonitor' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply
            </Button>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Delete confirmation drawer */}
      <Drawer open={showDelete} onOpenChange={setShowDelete}>
        <DrawerContent>
          <DrawerHeader className="text-center">
            <DrawerTitle>Delete {series.title}?</DrawerTitle>
            <DrawerDescription>
              This will remove the series from Sonarr and delete all files from disk. This action cannot be undone.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="w-full">
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Series & Files
            </Button>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
