'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Search, RefreshCw, Trash2, Eye, EyeOff, ArrowLeft, HardDrive, Film,
  Loader2, Star, Pencil, FolderSync, Info, Calendar, Tag, List,
} from 'lucide-react';
import { toast } from 'sonner';
import { getImageUrl } from '@/components/media/media-card';
import { InteractiveSearchDialog } from '@/components/media/interactive-search-dialog';
import { format } from 'date-fns';
import type { RadarrMovie, QualityProfile, RootFolder, Tag as TagType } from '@/types';

export default function MovieDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [movie, setMovie] = useState<RadarrMovie | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showInteractiveSearch, setShowInteractiveSearch] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  // Reference data for edit dialog
  const [qualityProfiles, setQualityProfiles] = useState<QualityProfile[]>([]);
  const [rootFolders, setRootFolders] = useState<RootFolder[]>([]);
  const [tags, setTags] = useState<TagType[]>([]);

  // Edit form state
  const [editQualityProfileId, setEditQualityProfileId] = useState<number>(0);
  const [editMinAvailability, setEditMinAvailability] = useState('');
  const [editTags, setEditTags] = useState<number[]>([]);
  const [editRootFolder, setEditRootFolder] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/radarr/${id}`).then((r) => r.ok ? r.json() : null),
      fetch('/api/radarr/qualityprofiles').then((r) => r.ok ? r.json() : []),
      fetch('/api/radarr/rootfolders').then((r) => r.ok ? r.json() : []),
      fetch('/api/radarr/tags').then((r) => r.ok ? r.json() : []),
    ])
      .then(([m, qp, rf, t]) => {
        setMovie(m);
        setQualityProfiles(qp);
        setRootFolders(rf);
        setTags(t);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  function openEditDialog() {
    if (!movie) return;
    setEditQualityProfileId(movie.qualityProfileId);
    setEditMinAvailability(movie.minimumAvailability);
    setEditTags([...movie.tags]);
    setEditRootFolder(movie.path ? movie.path.split('/').slice(0, -1).join('/') : '');
    setShowEdit(true);
  }

  async function handleSaveEdit() {
    if (!movie) return;
    setSaving(true);
    try {
      const updatedMovie = {
        ...movie,
        qualityProfileId: editQualityProfileId,
        minimumAvailability: editMinAvailability,
        tags: editTags,
      };
      // Update root folder path if changed
      if (editRootFolder && movie.path) {
        const movieFolder = movie.path.split('/').pop();
        updatedMovie.path = `${editRootFolder}/${movieFolder}`;
      }
      const res = await fetch(`/api/radarr/${movie.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedMovie),
      });
      if (res.ok) {
        const updated = await res.json();
        setMovie(updated);
        setShowEdit(false);
        toast.success('Movie updated');
      } else {
        toast.error('Failed to update movie');
      }
    } catch { toast.error('Failed to update movie'); }
    finally { setSaving(false); }
  }

  async function handleSearch() {
    if (!movie) return;
    setActionLoading('search');
    try {
      await fetch('/api/radarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'MoviesSearch', movieIds: [movie.id] }),
      });
      toast.success('Search started');
    } catch { toast.error('Search failed'); }
    finally { setActionLoading(''); }
  }

  async function handleRefresh() {
    if (!movie) return;
    setActionLoading('refresh');
    try {
      await fetch('/api/radarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'RefreshMovie', movieId: movie.id }),
      });
      toast.success('Refresh started');
    } catch { toast.error('Refresh failed'); }
    finally { setActionLoading(''); }
  }

  async function handleRename() {
    if (!movie) return;
    setActionLoading('rename');
    try {
      await fetch('/api/radarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'RenameFiles', movieId: movie.id }),
      });
      toast.success('Rename started');
    } catch { toast.error('Rename failed'); }
    finally { setActionLoading(''); }
  }

  async function handleToggleMonitored() {
    if (!movie) return;
    setActionLoading('monitor');
    try {
      const res = await fetch(`/api/radarr/${movie.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...movie, monitored: !movie.monitored }),
      });
      if (res.ok) {
        const updated = await res.json();
        setMovie(updated);
        toast.success(updated.monitored ? 'Now monitored' : 'Unmonitored');
      }
    } catch { toast.error('Failed to update'); }
    finally { setActionLoading(''); }
  }

  async function handleDelete() {
    if (!movie) return;
    setDeleting(true);
    try {
      await fetch(`/api/radarr/${movie.id}?deleteFiles=true`, { method: 'DELETE' });
      toast.success('Movie deleted');
      router.push('/movies');
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

  if (!movie) {
    return <div className="text-center py-12 text-muted-foreground">Movie not found</div>;
  }

  const fanart = getImageUrl(movie.images, 'fanart');
  const qualityProfile = qualityProfiles.find((qp) => qp.id === movie.qualityProfileId);
  const movieTags = tags.filter((t) => movie.tags.includes(t.id));

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.back()}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>

      {/* Fanart Banner */}
      {fanart && (
        <div className="relative h-48 md:h-64 rounded-lg overflow-hidden">
          <img src={fanart} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
        </div>
      )}

      {/* Title & Meta */}
      <div>
        <h1 className="text-2xl font-bold">{movie.title}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
          <span>{movie.year}</span>
          {movie.runtime > 0 && <span>{movie.runtime} min</span>}
          {movie.certification && <Badge variant="outline">{movie.certification}</Badge>}
          {movie.studio && <span>{movie.studio}</span>}
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {movie.genres?.map((g) => (
            <Badge key={g} variant="secondary" className="text-xs">{g}</Badge>
          ))}
        </div>
      </div>

      {/* Ratings */}
      {(movie.ratings?.imdb || movie.ratings?.tmdb) && (
        <div className="flex items-center gap-4">
          {movie.ratings.imdb && movie.ratings.imdb.value > 0 && (
            <div className="flex items-center gap-1.5 text-sm">
              <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
              <span className="font-medium">{movie.ratings.imdb.value.toFixed(1)}</span>
              <span className="text-muted-foreground text-xs">IMDB ({movie.ratings.imdb.votes.toLocaleString()})</span>
            </div>
          )}
          {movie.ratings.tmdb && movie.ratings.tmdb.value > 0 && (
            <div className="flex items-center gap-1.5 text-sm">
              <Star className="h-4 w-4 text-green-500 fill-green-500" />
              <span className="font-medium">{movie.ratings.tmdb.value.toFixed(1)}</span>
              <span className="text-muted-foreground text-xs">TMDB ({movie.ratings.tmdb.votes.toLocaleString()})</span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={handleSearch} disabled={!!actionLoading}>
          {actionLoading === 'search' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
          Search
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setShowInteractiveSearch(true)}>
          <List className="mr-2 h-4 w-4" /> Interactive
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
          {movie.monitored ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
          {movie.monitored ? 'Unmonitor' : 'Monitor'}
        </Button>
        <Button size="sm" variant="secondary" onClick={openEditDialog}>
          <Pencil className="mr-2 h-4 w-4" /> Edit
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setShowDelete(true)}>
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </Button>
      </div>

      {/* Overview */}
      {movie.overview && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground leading-relaxed">{movie.overview}</p>
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
            <Badge variant={movie.status === 'released' ? 'default' : 'secondary'}>{movie.status}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Quality Profile</span>
            <span>{qualityProfile?.name || 'Unknown'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Min. Availability</span>
            <span className="capitalize">{movie.minimumAvailability}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Path</span>
            <span className="text-xs truncate max-w-[200px]">{movie.path}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Size on Disk</span>
            <span>{formatBytes(movie.sizeOnDisk)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Added</span>
            <span>{movie.added ? format(new Date(movie.added), 'MMM d, yyyy') : 'Unknown'}</span>
          </div>
          {movieTags.length > 0 && (
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground">Tags</span>
              <div className="flex flex-wrap gap-1 justify-end">
                {movieTags.map((t) => (
                  <Badge key={t.id} variant="outline" className="text-[10px]">{t.label}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* File Info */}
      {movie.hasFile && movie.movieFile && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="h-4 w-4" /> File Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Quality</span>
              <span>{movie.movieFile.quality?.quality?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Size</span>
              <span>{formatBytes(movie.movieFile.size)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Path</span>
              <span className="text-xs truncate max-w-[200px]">{movie.movieFile.relativePath}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {!movie.hasFile && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Film className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No file on disk</p>
          </CardContent>
        </Card>
      )}

      {/* Interactive Search Dialog */}
      {movie && (
        <InteractiveSearchDialog
          open={showInteractiveSearch}
          onOpenChange={setShowInteractiveSearch}
          title={movie.title}
          service="radarr"
          searchParams={{ movieId: movie.id }}
        />
      )}

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {movie.title}</DialogTitle>
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
              <Label>Minimum Availability</Label>
              <Select value={editMinAvailability} onValueChange={setEditMinAvailability}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="announced">Announced</SelectItem>
                  <SelectItem value="inCinemas">In Cinemas</SelectItem>
                  <SelectItem value="released">Released</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {rootFolders.length > 0 && (
              <div className="space-y-2">
                <Label>Root Folder</Label>
                <Select value={editRootFolder} onValueChange={setEditRootFolder}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {rootFolders.map((rf) => (
                      <SelectItem key={rf.id} value={rf.path}>{rf.path}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
            <DialogTitle>Delete {movie.title}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This will remove the movie from Radarr and delete all files from disk.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
