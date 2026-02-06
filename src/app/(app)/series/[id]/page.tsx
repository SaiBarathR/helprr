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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Search, RefreshCw, Trash2, Eye, EyeOff, ArrowLeft, Tv, Loader2, Check, X,
  Download, Star, Pencil, FolderSync, Info, List,
} from 'lucide-react';
import { toast } from 'sonner';
import { getImageUrl } from '@/components/media/media-card';
import { InteractiveSearchDialog } from '@/components/media/interactive-search-dialog';
import { format } from 'date-fns';
import type { SonarrSeries, SonarrEpisode, QualityProfile, RootFolder, Tag as TagType } from '@/types';

export default function SeriesDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [series, setSeries] = useState<SonarrSeries | null>(null);
  const [episodes, setEpisodes] = useState<SonarrEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [interactiveSearch, setInteractiveSearch] = useState<{
    title: string;
    params: Record<string, string | number>;
  } | null>(null);

  // Reference data
  const [qualityProfiles, setQualityProfiles] = useState<QualityProfile[]>([]);
  const [rootFolders, setRootFolders] = useState<RootFolder[]>([]);
  const [tags, setTags] = useState<TagType[]>([]);

  // Edit form state
  const [editQualityProfileId, setEditQualityProfileId] = useState<number>(0);
  const [editSeriesType, setEditSeriesType] = useState('');
  const [editTags, setEditTags] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

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

  const seasonNumbers = [...new Set(episodes.map((e) => e.seasonNumber))].sort((a, b) => a - b);

  function openEditDialog() {
    if (!series) return;
    setEditQualityProfileId(series.qualityProfileId);
    setEditSeriesType(series.seriesType);
    setEditTags([...series.tags]);
    setShowEdit(true);
  }

  async function handleSaveEdit() {
    if (!series) return;
    setSaving(true);
    try {
      const updatedSeries = {
        ...series,
        qualityProfileId: editQualityProfileId,
        seriesType: editSeriesType,
        tags: editTags,
      };
      const res = await fetch(`/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSeries),
      });
      if (res.ok) {
        const updated = await res.json();
        setSeries(updated);
        setShowEdit(false);
        toast.success('Series updated');
      } else {
        toast.error('Failed to update series');
      }
    } catch { toast.error('Failed to update series'); }
    finally { setSaving(false); }
  }

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

  async function handleRename() {
    if (!series) return;
    setActionLoading('rename');
    try {
      await fetch('/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'RenameSeries', seriesId: series.id }),
      });
      toast.success('Rename started');
    } catch { toast.error('Rename failed'); }
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

  function formatBytes(bytes: number) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function toggleTag(tagId: number) {
    setEditTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
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
  const qualityProfile = qualityProfiles.find((qp) => qp.id === series.qualityProfileId);
  const seriesTags = tags.filter((t) => series.tags.includes(t.id));
  const episodeProgress = series.statistics
    ? Math.round((series.statistics.episodeFileCount / Math.max(series.statistics.episodeCount, 1)) * 100)
    : 0;

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

      {/* Title & Meta */}
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

      {/* Rating */}
      {series.ratings && series.ratings.value > 0 && (
        <div className="flex items-center gap-1.5 text-sm">
          <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
          <span className="font-medium">{series.ratings.value.toFixed(1)}/10</span>
          <span className="text-muted-foreground text-xs">({series.ratings.votes.toLocaleString()} votes)</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={handleSearchAll} disabled={!!actionLoading}>
          {actionLoading === 'search' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Search All
        </Button>
        <Button size="sm" variant="secondary" onClick={handleRefresh} disabled={!!actionLoading}>
          {actionLoading === 'refresh' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
        <Button size="sm" variant="secondary" onClick={handleRename} disabled={!!actionLoading}>
          {actionLoading === 'rename' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderSync className="mr-2 h-4 w-4" />}
          Rename
        </Button>
        <Button size="sm" variant="secondary" onClick={handleToggleMonitored} disabled={!!actionLoading}>
          {series.monitored ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
          {series.monitored ? 'Unmonitor' : 'Monitor'}
        </Button>
        <Button size="sm" variant="secondary" onClick={openEditDialog}>
          <Pencil className="mr-2 h-4 w-4" /> Edit
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setShowDelete(true)}>
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </Button>
      </div>

      {/* Overview */}
      {series.overview && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground leading-relaxed">{series.overview}</p>
          </CardContent>
        </Card>
      )}

      {/* Details Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4" /> Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <Badge variant={series.status === 'continuing' ? 'default' : 'secondary'}>{series.status}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Quality Profile</span>
            <span>{qualityProfile?.name || 'Unknown'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Series Type</span>
            <span className="capitalize">{series.seriesType}</span>
          </div>
          {series.network && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Network</span>
              <span>{series.network}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Path</span>
            <span className="text-xs truncate max-w-[200px]">{series.path}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Size on Disk</span>
            <span>{formatBytes(series.statistics?.sizeOnDisk || 0)}</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Episodes</span>
              <span>{series.statistics?.episodeFileCount || 0} / {series.statistics?.episodeCount || 0}</span>
            </div>
            <Progress value={episodeProgress} className="h-1.5" />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Added</span>
            <span>{series.added ? format(new Date(series.added), 'MMM d, yyyy') : 'Unknown'}</span>
          </div>
          {seriesTags.length > 0 && (
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground">Tags</span>
              <div className="flex flex-wrap gap-1 justify-end">
                {seriesTags.map((t) => (
                  <Badge key={t.id} variant="outline" className="text-[10px]">{t.label}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Seasons Accordion */}
      <Accordion type="multiple" className="space-y-2">
        {seasonNumbers.map((sn) => {
          const seasonEps = episodes.filter((e) => e.seasonNumber === sn).sort((a, b) => a.episodeNumber - b.episodeNumber);
          const fileCount = seasonEps.filter((e) => e.hasFile).length;
          const seasonData = series.seasons.find((s) => s.seasonNumber === sn);
          const isSeasonMonitored = seasonData?.monitored ?? true;

          return (
            <AccordionItem key={sn} value={`season-${sn}`} className="border rounded-lg px-4">
              <div className="flex items-center gap-2">
                <AccordionTrigger className="hover:no-underline flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{sn === 0 ? 'Specials' : `Season ${sn}`}</span>
                    <Badge variant="secondary" className="text-xs">
                      {fileCount}/{seasonEps.length}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <Switch
                  checked={isSeasonMonitored}
                  onCheckedChange={(v) => { handleToggleSeasonMonitor(sn, v); }}
                  className="scale-75"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2"
                  title="Automatic search"
                  onClick={() => handleSearchSeason(sn)}
                >
                  <Download className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2"
                  title="Interactive search"
                  onClick={() => setInteractiveSearch({
                    title: `${series.title} - ${sn === 0 ? 'Specials' : `Season ${sn}`}`,
                    params: { seriesId: series.id, seasonNumber: sn },
                  })}
                >
                  <List className="h-3 w-3" />
                </Button>
              </div>
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
                        title="Automatic search"
                        onClick={() => handleSearchEpisode(ep.id)}
                      >
                        <Search className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        title="Interactive search"
                        onClick={() => setInteractiveSearch({
                          title: `${series.title} - S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')} - ${ep.title || 'TBA'}`,
                          params: { episodeId: ep.id },
                        })}
                      >
                        <List className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* Interactive Search Dialog */}
      <InteractiveSearchDialog
        open={!!interactiveSearch}
        onOpenChange={(v) => { if (!v) setInteractiveSearch(null); }}
        title={interactiveSearch?.title || ''}
        service="sonarr"
        searchParams={interactiveSearch?.params || {}}
        showSeasonPackFilter={interactiveSearch?.params?.seasonNumber !== undefined}
      />

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {series.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Quality Profile</Label>
              <Select value={String(editQualityProfileId)} onValueChange={(v) => setEditQualityProfileId(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {qualityProfiles.map((qp) => (
                    <SelectItem key={qp.id} value={String(qp.id)}>{qp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Series Type</Label>
              <Select value={editSeriesType} onValueChange={setEditSeriesType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="anime">Anime</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tags.length > 0 && (
              <div className="space-y-2">
                <Label>Tags</Label>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <Badge
                      key={t.id}
                      variant={editTags.includes(t.id) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => toggleTag(t.id)}
                    >
                      {t.label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
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
