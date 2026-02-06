'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Search, RefreshCw, Trash2, Eye, EyeOff, ArrowLeft, Tv, Loader2, Check, X, Download } from 'lucide-react';
import { toast } from 'sonner';
import { getImageUrl } from '@/components/media/media-card';
import { format } from 'date-fns';
import type { SonarrSeries, SonarrEpisode } from '@/types';

export default function SeriesDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [series, setSeries] = useState<SonarrSeries | null>(null);
  const [episodes, setEpisodes] = useState<SonarrEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  useEffect(() => {
    Promise.all([
      fetch(`/api/sonarr/${id}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/sonarr/${id}/episodes`).then((r) => r.ok ? r.json() : []),
    ])
      .then(([s, e]) => { setSeries(s); setEpisodes(e); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const seasonNumbers = [...new Set(episodes.map((e) => e.seasonNumber))].sort((a, b) => a - b);

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

  async function handleSearchSeason(seasonNumber: number) {
    if (!series) return;
    try {
      await fetch('/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SeasonSearch', seriesId: series.id, seasonNumber }),
      });
      toast.success(`Season ${seasonNumber} search started`);
    } catch { toast.error('Search failed'); }
  }

  async function handleSearchEpisode(episodeId: number) {
    try {
      await fetch('/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'EpisodeSearch', episodeIds: [episodeId] }),
      });
      toast.success('Episode search started');
    } catch { toast.error('Search failed'); }
  }

  async function handleToggleEpisodeMonitor(episodeId: number, monitored: boolean) {
    try {
      const res = await fetch('/api/sonarr/episode/monitor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeIds: [episodeId], monitored }),
      });
      if (res.ok) {
        setEpisodes((prev) => prev.map((e) => e.id === episodeId ? { ...e, monitored } : e));
      }
    } catch { toast.error('Failed to update'); }
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

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!series) {
    return <div className="text-center py-12 text-muted-foreground">Series not found</div>;
  }

  const fanart = getImageUrl(series.images, 'fanart');

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.back()}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>

      {fanart && (
        <div className="relative h-48 md:h-64 rounded-lg overflow-hidden">
          <img src={fanart} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold">{series.title}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
          <span>{series.year}</span>
          {series.network && <span>{series.network}</span>}
          <Badge variant={series.status === 'continuing' ? 'default' : 'secondary'}>
            {series.status}
          </Badge>
          {series.runtime > 0 && <span>{series.runtime} min</span>}
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {series.genres?.map((g) => <Badge key={g} variant="secondary" className="text-xs">{g}</Badge>)}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={handleSearchAll} disabled={!!actionLoading}>
          {actionLoading === 'search' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Search All
        </Button>
        <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={!!actionLoading}>
          {actionLoading === 'refresh' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
        <Button size="sm" variant="secondary" onClick={handleToggleMonitored} disabled={!!actionLoading}>
          {series.monitored ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
          {series.monitored ? 'Unmonitor' : 'Monitor'}
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setShowDelete(true)}>
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </Button>
      </div>

      {series.overview && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground leading-relaxed">{series.overview}</p>
          </CardContent>
        </Card>
      )}

      {/* Seasons Accordion */}
      <Accordion type="multiple" className="space-y-2">
        {seasonNumbers.map((sn) => {
          const seasonEps = episodes.filter((e) => e.seasonNumber === sn).sort((a, b) => a.episodeNumber - b.episodeNumber);
          const fileCount = seasonEps.filter((e) => e.hasFile).length;
          return (
            <AccordionItem key={sn} value={`season-${sn}`} className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{sn === 0 ? 'Specials' : `Season ${sn}`}</span>
                  <Badge variant="secondary" className="text-xs">
                    {fileCount}/{seasonEps.length}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2"
                    onClick={(e) => { e.stopPropagation(); handleSearchSeason(sn); }}
                  >
                    <Download className="h-3 w-3" />
                  </Button>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-1">
                  {seasonEps.map((ep) => (
                    <div key={ep.id} className="flex items-center gap-2 py-1.5 text-sm">
                      <span className="w-8 text-muted-foreground text-xs text-right">{ep.episodeNumber}</span>
                      <div className="flex-1 min-w-0">
                        <span className="truncate block">{ep.title || 'TBA'}</span>
                        {ep.airDate && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(ep.airDate), 'MMM d, yyyy')}
                          </span>
                        )}
                      </div>
                      {ep.hasFile ? (
                        <Check className="h-4 w-4 text-green-500 shrink-0" />
                      ) : (
                        <X className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <Switch
                        checked={ep.monitored}
                        onCheckedChange={(v) => handleToggleEpisodeMonitor(ep.id, v)}
                        className="scale-75"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => handleSearchEpisode(ep.id)}
                      >
                        <Search className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {series.title}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This will remove the series from Sonarr and delete all files from disk.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
