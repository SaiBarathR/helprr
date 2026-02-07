'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Plus, Loader2, Tv } from 'lucide-react';
import { toast } from 'sonner';
import type { SonarrLookupResult, QualityProfile, RootFolder } from '@/types';

export default function AddSeriesPage() {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SonarrLookupResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SonarrLookupResult | null>(null);
  const [profiles, setProfiles] = useState<QualityProfile[]>([]);
  const [rootFolders, setRootFolders] = useState<RootFolder[]>([]);
  const [profileId, setProfileId] = useState('');
  const [rootFolder, setRootFolder] = useState('');
  const [monitored, setMonitored] = useState(true);
  const [seriesType, setSeriesType] = useState('standard');
  const [seasonFolder, setSeasonFolder] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/sonarr/qualityprofiles').then((r) => r.ok ? r.json() : []),
      fetch('/api/sonarr/rootfolders').then((r) => r.ok ? r.json() : []),
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
      const res = await fetch(`/api/sonarr/lookup?term=${encodeURIComponent(term)}`);
      if (res.ok) setResults(await res.json());
    } catch { toast.error('Search failed'); }
    finally { setSearching(false); }
  }

  async function handleAdd() {
    if (!selected || !profileId || !rootFolder) return;
    setAdding(true);
    try {
      const res = await fetch('/api/sonarr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: selected.title,
          tvdbId: selected.tvdbId,
          qualityProfileId: Number(profileId),
          rootFolderPath: rootFolder,
          monitored,
          seriesType,
          seasonFolder,
          titleSlug: selected.titleSlug,
          images: selected.images,
          seasons: selected.seasons,
          year: selected.year,
          addOptions: { monitor: 'all', searchForMissingEpisodes: true, searchForCutoffUnmetEpisodes: false },
        }),
      });
      if (res.ok) {
        const s = await res.json();
        toast.success(`${selected.title} added`);
        router.push(`/series/${s.id}`);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to add series');
      }
    } catch { toast.error('Failed to add series'); }
    finally { setAdding(false); }
  }

  const posterUrl = (images: { coverType: string; remoteUrl: string }[]) =>
    images.find((i) => i.coverType === 'poster')?.remoteUrl;

  const SERIES_TYPE_OPTIONS = [
    { value: 'standard', label: 'Standard' },
    { value: 'daily', label: 'Daily' },
    { value: 'anime', label: 'Anime' },
  ];

  function getSeriesTypeLabel(value: string) {
    return SERIES_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
  }

  function getProfileLabel(id: string) {
    return profiles.find((p) => String(p.id) === id)?.name ?? id;
  }

  function getRootFolderLabel(path: string) {
    return path || 'Select folder';
  }

  return (
    <div>
      <PageHeader title="Add Series" />

      <div className="px-4 space-y-4 mt-2 pb-8">
        {/* Search form */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <Input
            placeholder="Search for a TV series..."
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="flex-1 h-10"
          />
          <Button type="submit" disabled={searching} className="h-10 w-10 p-0 shrink-0">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </form>

        {selected ? (
          <div className="space-y-5">
            {/* Series info */}
            <div className="flex gap-4">
              {posterUrl(selected.images as { coverType: string; remoteUrl: string }[]) ? (
                <img
                  src={posterUrl(selected.images as { coverType: string; remoteUrl: string }[])!}
                  alt=""
                  className="w-24 aspect-[2/3] object-cover rounded-lg shrink-0"
                />
              ) : (
                <div className="w-24 aspect-[2/3] bg-muted rounded-lg flex items-center justify-center shrink-0">
                  <Tv className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold leading-tight">{selected.title}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {selected.year}{selected.network ? ` \u00b7 ${selected.network}` : ''}
                </p>
                {selected.overview && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-3 leading-snug">
                    {selected.overview}
                  </p>
                )}
              </div>
            </div>

            {/* Options as grouped rows */}
            <div className="grouped-section">
              <div className="grouped-section-title">Options</div>
              <div className="grouped-section-content">
                <div className="grouped-row">
                  <Label className="text-sm shrink-0">Quality Profile</Label>
                  <Select value={profileId} onValueChange={setProfileId}>
                    <SelectTrigger className="w-auto h-auto border-0 bg-transparent p-0 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                      <SelectValue>{getProfileLabel(profileId)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grouped-row">
                  <Label className="text-sm shrink-0">Root Folder</Label>
                  <Select value={rootFolder} onValueChange={setRootFolder}>
                    <SelectTrigger className="w-auto h-auto border-0 bg-transparent p-0 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5 max-w-[180px]">
                      <SelectValue>{getRootFolderLabel(rootFolder)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {rootFolders.map((f) => (
                        <SelectItem key={f.id} value={f.path}>{f.path}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grouped-row">
                  <Label className="text-sm shrink-0">Series Type</Label>
                  <Select value={seriesType} onValueChange={setSeriesType}>
                    <SelectTrigger className="w-auto h-auto border-0 bg-transparent p-0 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                      <SelectValue>{getSeriesTypeLabel(seriesType)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {SERIES_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grouped-row">
                  <Label className="text-sm shrink-0">Monitored</Label>
                  <Switch checked={monitored} onCheckedChange={setMonitored} />
                </div>

                <div className="grouped-row" style={{ borderBottom: 'none' }}>
                  <Label className="text-sm shrink-0">Season Folders</Label>
                  <Switch checked={seasonFolder} onCheckedChange={setSeasonFolder} />
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button className="flex-1 h-11" onClick={handleAdd} disabled={adding}>
                {adding ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Add Series
              </Button>
              <Button variant="ghost" className="flex-1 h-11" onClick={() => setSelected(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5">
            {searching
              ? [...Array(9)].map((_, i) => <Skeleton key={i} className="aspect-[2/3] rounded-lg" />)
              : results.map((r) => (
                  <button
                    key={r.tvdbId}
                    onClick={() => setSelected(r)}
                    className="text-left group"
                  >
                    <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted">
                      {posterUrl(r.images as { coverType: string; remoteUrl: string }[]) ? (
                        <img
                          src={posterUrl(r.images as { coverType: string; remoteUrl: string }[])!}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform"
                          loading="lazy"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Tv className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                      <div className="absolute bottom-0 p-1.5">
                        <p className="text-[11px] font-medium text-white truncate leading-tight">{r.title}</p>
                        <p className="text-[10px] text-white/70">{r.year}</p>
                      </div>
                    </div>
                  </button>
                ))}
          </div>
        )}
      </div>
    </div>
  );
}
