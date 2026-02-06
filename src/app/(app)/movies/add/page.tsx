'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, ArrowLeft, Plus, Loader2, Film } from 'lucide-react';
import { toast } from 'sonner';
import type { RadarrLookupResult, QualityProfile, RootFolder } from '@/types';

export default function AddMoviePage() {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<RadarrLookupResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<RadarrLookupResult | null>(null);
  const [profiles, setProfiles] = useState<QualityProfile[]>([]);
  const [rootFolders, setRootFolders] = useState<RootFolder[]>([]);
  const [profileId, setProfileId] = useState('');
  const [rootFolder, setRootFolder] = useState('');
  const [monitored, setMonitored] = useState(true);
  const [minAvailability, setMinAvailability] = useState('released');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/radarr/qualityprofiles').then((r) => r.ok ? r.json() : []),
      fetch('/api/radarr/rootfolders').then((r) => r.ok ? r.json() : []),
    ]).then(([p, r]) => {
      setProfiles(p);
      setRootFolders(r);
      if (p.length > 0) setProfileId(String(p[0].id));
      if (r.length > 0) setRootFolder(r[0].path);
    });
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!term.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/radarr/lookup?term=${encodeURIComponent(term)}`);
      if (res.ok) setResults(await res.json());
    } catch { toast.error('Search failed'); }
    finally { setSearching(false); }
  }

  async function handleAdd() {
    if (!selected || !profileId || !rootFolder) return;
    setAdding(true);
    try {
      const res = await fetch('/api/radarr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: selected.title,
          tmdbId: selected.tmdbId,
          qualityProfileId: Number(profileId),
          rootFolderPath: rootFolder,
          monitored,
          minimumAvailability: minAvailability,
          titleSlug: selected.titleSlug,
          images: selected.images,
          year: selected.year,
          addOptions: { searchForMovie: true },
        }),
      });
      if (res.ok) {
        const movie = await res.json();
        toast.success(`${selected.title} added`);
        router.push(`/movies/${movie.id}`);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to add movie');
      }
    } catch { toast.error('Failed to add movie'); }
    finally { setAdding(false); }
  }

  const posterUrl = (images: { coverType: string; remoteUrl: string }[]) =>
    images.find((i) => i.coverType === 'poster')?.remoteUrl;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.back()}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>
      <h1 className="text-2xl font-bold">Add Movie</h1>

      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          placeholder="Search for a movie..."
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={searching}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </form>

      {selected ? (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="flex gap-4">
              {posterUrl(selected.images as { coverType: string; remoteUrl: string }[]) ? (
                <img src={posterUrl(selected.images as { coverType: string; remoteUrl: string }[])!} alt="" className="w-24 rounded" />
              ) : (
                <div className="w-24 aspect-[2/3] bg-muted rounded flex items-center justify-center">
                  <Film className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div>
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <p className="text-sm text-muted-foreground">{selected.year}</p>
                <p className="text-sm text-muted-foreground mt-1 line-clamp-3">{selected.overview}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Quality Profile</Label>
                <Select value={profileId} onValueChange={setProfileId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Root Folder</Label>
                <Select value={rootFolder} onValueChange={setRootFolder}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {rootFolders.map((f) => (
                      <SelectItem key={f.id} value={f.path}>{f.path}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Minimum Availability</Label>
                <Select value={minAvailability} onValueChange={setMinAvailability}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="announced">Announced</SelectItem>
                    <SelectItem value="inCinemas">In Cinemas</SelectItem>
                    <SelectItem value="released">Released</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <Switch checked={monitored} onCheckedChange={setMonitored} id="monitored" />
                <Label htmlFor="monitored">Monitored</Label>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleAdd} disabled={adding}>
                {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Add Movie
              </Button>
              <Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {searching
            ? [...Array(8)].map((_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-lg" />)
            : results.map((r) => (
                <button
                  key={r.tmdbId}
                  onClick={() => setSelected(r)}
                  className="text-left group"
                >
                  <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted">
                    {posterUrl(r.images as { coverType: string; remoteUrl: string }[]) ? (
                      <img src={posterUrl(r.images as { coverType: string; remoteUrl: string }[])!} alt="" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Film className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                    <div className="absolute bottom-0 p-2">
                      <p className="text-xs font-medium text-white truncate">{r.title}</p>
                      <p className="text-[10px] text-white/70">{r.year}</p>
                    </div>
                  </div>
                </button>
              ))}
        </div>
      )}
    </div>
  );
}
