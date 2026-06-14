'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Search, Plus, Loader2, Disc3, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { LidarrArtistLookupResult, MediaImage } from '@/types';
import {
  useQualityProfiles,
  useMetadataProfiles,
  useRootFolders,
  useTags,
} from '@/lib/hooks/use-reference-data';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';

const MONITOR_OPTIONS = [
  { value: 'all', label: 'All Albums' },
  { value: 'future', label: 'Future Albums' },
  { value: 'missing', label: 'Missing Albums' },
  { value: 'existing', label: 'Existing Albums' },
  { value: 'latest', label: 'Latest Album' },
  { value: 'first', label: 'First Album' },
  { value: 'none', label: 'None' },
];

function posterUrl(images: MediaImage[] | undefined, remotePoster?: string) {
  const remote = images?.find((i) => i.coverType === 'poster')?.remoteUrl || remotePoster;
  return toCachedImageSrc(remote, 'lidarr');
}

function AddArtistPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<LidarrArtistLookupResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<LidarrArtistLookupResult | null>(null);
  const [profileId, setProfileId] = useState('');
  const [metadataProfileId, setMetadataProfileId] = useState('');
  const [rootFolder, setRootFolder] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [monitor, setMonitor] = useState('all');
  const [monitorNewItems, setMonitorNewItems] = useState<'all' | 'none'>('all');
  const [searchOnAdd, setSearchOnAdd] = useState(true);
  const [adding, setAdding] = useState(false);
  const [autoSearched, setAutoSearched] = useState(false);
  const [instances, setInstances] = useState<{ id: string; label: string; isDefault: boolean }[]>([]);
  const [instanceId, setInstanceId] = useState<string | undefined>(undefined);
  // Per-instance reference data, shared (and deduped) with the list/edit pages.
  const { data: profiles = [] } = useQualityProfiles('lidarr', instanceId);
  const { data: metadataProfiles = [] } = useMetadataProfiles(instanceId);
  const { data: rootFolders = [] } = useRootFolders('lidarr', instanceId);
  const { data: tags = [] } = useTags('lidarr', instanceId);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Load Lidarr instances; default to the marked default (picker only shows when >1).
  useEffect(() => {
    fetch('/api/instances')
      .then((r) => (r.ok ? r.json() : []))
      .then((all: Array<{ id: string; type: string; label: string; isDefault: boolean }>) => {
        const list = (Array.isArray(all) ? all : [])
          .filter((c) => c.type === 'LIDARR')
          .map((c) => ({ id: c.id, label: c.label, isDefault: c.isDefault }));
        setInstances(list);
        setInstanceId((prev) => prev ?? list.find((i) => i.isDefault)?.id ?? list[0]?.id);
      })
      .catch(() => undefined);
  }, []);

  // Switching instances invalidates the previously-picked (instance-local)
  // profile/folder/tag ids — clear them so a stale value can't be POSTed before
  // the new instance's reference data arrives (the effects below re-default).
  useEffect(() => {
    setProfileId('');
    setMetadataProfileId('');
    setRootFolder('');
    setSelectedTags([]);
  }, [instanceId]);

  // Default the profile / metadata-profile / root-folder selection to the first
  // option when the instance's reference data arrives. Keep a still-valid user
  // choice on a background refetch; re-default only when it's missing now.
  useEffect(() => {
    if (profiles.length === 0) return;
    setProfileId((prev) => (prev && profiles.some((p) => String(p.id) === prev) ? prev : String(profiles[0].id)));
  }, [profiles]);
  useEffect(() => {
    if (metadataProfiles.length === 0) return;
    setMetadataProfileId((prev) => (prev && metadataProfiles.some((p) => String(p.id) === prev) ? prev : String(metadataProfiles[0].id)));
  }, [metadataProfiles]);
  useEffect(() => {
    if (rootFolders.length === 0) return;
    setRootFolder((prev) => (prev && rootFolders.some((f) => f.path === prev) ? prev : rootFolders[0].path));
  }, [rootFolders]);

  useEffect(() => () => searchAbortRef.current?.abort(), []);

  const runSearch = useCallback(async (searchTerm: string) => {
    searchAbortRef.current?.abort();
    if (!searchTerm.trim()) {
      searchAbortRef.current = null;
      setResults([]);
      setSelected(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    searchAbortRef.current = controller;
    setSearching(true);
    try {
      const res = await fetch(`/api/lidarr/lookup?term=${encodeURIComponent(searchTerm)}`, { signal });
      if (signal.aborted || searchAbortRef.current !== controller) return;
      if (!res.ok) {
        setResults([]);
        toast.error(`Search failed (${res.status})`);
        return;
      }
      const data: LidarrArtistLookupResult[] = await res.json();
      if (signal.aborted || searchAbortRef.current !== controller) return;
      setResults(data);
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError' || signal.aborted) return;
      setResults([]);
      toast.error('Search failed');
    } finally {
      if (!signal.aborted && searchAbortRef.current === controller) {
        setSearching(false);
        searchAbortRef.current = null;
      }
    }
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    await runSearch(term);
  }

  async function handleAdd() {
    if (!selected || !profileId || !metadataProfileId || !rootFolder) return;
    if (selected.library?.exists) {
      if (selected.library.id) {
        router.push(`/music/${selected.library.id}${instanceId ? `?instance=${instanceId}` : ''}`);
        return;
      }
      toast.error('Artist is already in library, but detail link is unavailable');
      return;
    }

    setAdding(true);
    try {
      const res = await fetch('/api/lidarr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId,
          artistName: selected.artistName,
          foreignArtistId: selected.foreignArtistId,
          qualityProfileId: Number(profileId),
          metadataProfileId: Number(metadataProfileId),
          rootFolderPath: rootFolder,
          monitored: monitor !== 'none',
          monitorNewItems,
          tags: selectedTags,
          images: selected.images,
          addOptions: { monitor, searchForMissingAlbums: searchOnAdd },
        }),
      });
      if (res.ok) {
        const artist = await res.json();
        toast.success(`${selected.artistName} added`);
        router.push(`/music/${artist.id}${instanceId ? `?instance=${instanceId}` : ''}`);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to add artist');
      }
    } catch { toast.error('Failed to add artist'); }
    finally { setAdding(false); }
  }

  function toggleTag(tagId: number, checked: boolean) {
    setSelectedTags((prev) => {
      if (checked) return prev.includes(tagId) ? prev : [...prev, tagId];
      return prev.filter((id) => id !== tagId);
    });
  }

  function getTagsLabel() {
    if (selectedTags.length === 0) return 'No tags';
    if (selectedTags.length === 1) return tags.find((t) => t.id === selectedTags[0])?.label ?? '1 tag';
    return `${selectedTags.length} tags`;
  }

  const selectedInLibrary = selected?.library?.exists === true;
  const selectedPoster = selected ? posterUrl(selected.images, selected.remotePoster) : null;

  useEffect(() => {
    const prefill = searchParams.get('term');
    if (prefill) setTerm(prefill);
  }, [searchParams]);

  useEffect(() => {
    if (autoSearched) return;
    const prefill = searchParams.get('term');
    if (!prefill) return;
    setAutoSearched(true);
    runSearch(prefill);
  }, [searchParams, autoSearched, runSearch]);

  return (
    <div className="animate-content-in">
      <PageHeader title="Add Artist" />

      <div className="space-y-4 mt-1 pb-8">
        <form onSubmit={handleSearch} className="flex gap-2">
          <Input
            placeholder="Search for an artist..."
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
            <div className="flex gap-4">
              {selectedPoster ? (
                <Image
                  src={selectedPoster}
                  alt=""
                  width={96}
                  height={144}
                  className="w-24 h-auto aspect-[2/3] object-cover rounded-lg shrink-0"
                  unoptimized={isProtectedApiImageSrc(selectedPoster)}
                />
              ) : (
                <div className="w-24 aspect-[2/3] bg-muted rounded-lg flex items-center justify-center shrink-0">
                  <Disc3 className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold leading-tight">{selected.artistName}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {[selected.artistType, selected.disambiguation].filter(Boolean).join(' · ')}
                </p>
                {selectedInLibrary && (
                  <Badge className="mt-2 bg-green-600/90 text-foreground">
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Added
                  </Badge>
                )}
                {selected.overview && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-3 leading-snug">{selected.overview}</p>
                )}
              </div>
            </div>

            {selectedInLibrary ? (
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">
                This artist is already in your library.
              </div>
            ) : (
              <div className="grouped-section">
                <div className="grouped-section-title">Options</div>
                <div className="grouped-section-content">
                  {instances.length > 1 && (
                    <div className="grouped-row">
                      <Label className="text-sm shrink-0">Instance</Label>
                      <Select value={instanceId ?? ''} onValueChange={setInstanceId}>
                        <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                          <SelectValue>{instances.find((i) => i.id === instanceId)?.label ?? 'Select'}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {instances.map((i) => (
                            <SelectItem key={i.id} value={i.id}>{i.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Quality Profile</Label>
                    <Select value={profileId} onValueChange={setProfileId}>
                      <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                        <SelectValue>{profiles.find((p) => String(p.id) === profileId)?.name ?? 'Select'}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {profiles.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Metadata Profile</Label>
                    <Select value={metadataProfileId} onValueChange={setMetadataProfileId}>
                      <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                        <SelectValue>{metadataProfiles.find((p) => String(p.id) === metadataProfileId)?.name ?? 'Select'}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {metadataProfiles.map((p) => (
                          <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Root Folder</Label>
                    <Select value={rootFolder} onValueChange={setRootFolder}>
                      <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5 max-w-[180px]">
                        <SelectValue>{rootFolder || 'Select folder'}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {rootFolders.map((f) => (
                          <SelectItem key={f.id} value={f.path}>{f.path}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Monitor</Label>
                    <Select value={monitor} onValueChange={setMonitor}>
                      <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                        <SelectValue>{MONITOR_OPTIONS.find((o) => o.value === monitor)?.label ?? monitor}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {MONITOR_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grouped-row">
                    <Label className="text-sm shrink-0">Monitor New Albums</Label>
                    <Select value={monitorNewItems} onValueChange={(v) => setMonitorNewItems(v as 'all' | 'none')}>
                      <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                        <SelectValue>{monitorNewItems === 'all' ? 'All' : 'None'}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="none">None</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grouped-row" style={tags.length === 0 ? { borderBottom: 'none' } : undefined}>
                    <Label className="text-sm shrink-0">Search on Add</Label>
                    <Switch checked={searchOnAdd} onCheckedChange={setSearchOnAdd} />
                  </div>

                  {tags.length > 0 && (
                    <div className="grouped-row" style={{ borderBottom: 'none' }}>
                      <Label className="text-sm shrink-0">Tags</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center justify-end rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/40 transition-colors"
                          >
                            {getTagsLabel()}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          {tags.map((tag) => (
                            <DropdownMenuCheckboxItem
                              key={tag.id}
                              checked={selectedTags.includes(tag.id)}
                              onCheckedChange={(checked) => toggleTag(tag.id, checked === true)}
                            >
                              {tag.label}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              {selectedInLibrary ? (
                <Button
                  className="flex-1 h-11"
                  onClick={() => {
                    if (selected.library?.id) router.push(`/music/${selected.library.id}${instanceId ? `?instance=${instanceId}` : ''}`);
                    else toast.error('Artist is already in library, but detail link is unavailable');
                  }}
                >
                  Open in Library
                </Button>
              ) : (
                <Button className="flex-1 h-11" onClick={handleAdd} disabled={adding}>
                  {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Add Artist
                </Button>
              )}
              <Button variant="ghost" className="flex-1 h-11" onClick={() => setSelected(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5">
            {searching ? (
              <div className="col-span-full flex justify-center"><PageSpinner /></div>
            ) : (
              results.map((r) => {
                const poster = posterUrl(r.images, r.remotePoster);
                return (
                  <button key={r.foreignArtistId} onClick={() => setSelected(r)} className="text-left group">
                    <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted">
                      {poster ? (
                        <Image
                          src={poster}
                          alt=""
                          fill
                          sizes="(max-width: 640px) 33vw, (max-width: 768px) 25vw, (max-width: 1024px) 20vw, 16vw"
                          className="object-cover group-hover:scale-105 transition-transform"
                          unoptimized={isProtectedApiImageSrc(poster)}
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Disc3 className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
                      {r.library?.exists && (
                        <div className="absolute top-1.5 right-1.5">
                          <Badge className="bg-green-600/90 text-foreground text-[10px]">
                            <Check className="mr-1 h-3 w-3" />
                            Added
                          </Badge>
                        </div>
                      )}
                      <div className="absolute bottom-0 p-1.5">
                        <p className="text-[11px] font-medium text-foreground truncate leading-tight">{r.artistName}</p>
                        {r.artistType && <p className="text-[10px] text-foreground/70">{r.artistType}</p>}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AddArtistPage() {
  return (
    <Suspense fallback={<div className="py-6 text-sm text-muted-foreground">Loading add artist...</div>}>
      <AddArtistPageContent />
    </Suspense>
  );
}
