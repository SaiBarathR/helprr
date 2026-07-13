'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Check,
  ChevronDown,
  ChevronRight,
  File,
  FileUp,
  Film,
  Folder,
  Link as LinkIcon,
  Loader2,
  Search,
  Tv,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FadeInImage } from '@/components/media/fade-in-image';
import { formatBytes } from '@/lib/format';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { cn } from '@/lib/utils';
import { useCan } from '@/components/permission-provider';
import { Label } from '@/components/ui/label';
import { useQualityProfiles, useRootFolders } from '@/lib/hooks/use-reference-data';
import { queryKeys } from '@/lib/query-keys';
import type { MediaImage, RadarrLookupResult, SonarrLookupResult } from '@/types';
import type { TorrentFile } from '@/lib/qbittorrent-client';
import {
  buildFileTree,
  getAllFileIndices,
  getCheckState,
  type TreeNode,
  type DirNode,
  type FileNode,
} from '@/lib/torrent-file-tree';

type ApiResult = {
  success?: boolean;
  error?: string;
  hash?: string;
  manualOverride?: boolean;
};

type PreflightResult = {
  service: 'SONARR' | 'RADARR';
  instanceId: string;
  externalId: number;
  arrSelectsClient: boolean;
  downloadClients: Array<{ id: number; name: string; priority: number }>;
  error?: string;
};

type MappingConfig = {
  service: 'SONARR' | 'RADARR';
  instanceId: string;
  media: Record<string, unknown>;
  title: string;
};

const NO_CATEGORY = '__none__';

async function parseApiResult(res: Response): Promise<ApiResult> {
  try {
    return await res.json() as ApiResult;
  } catch {
    return {};
  }
}

function magnetDisplayName(link: string): string | null {
  const queryStart = link.indexOf('?');
  if (queryStart < 0) return null;
  return new URLSearchParams(link.slice(queryStart + 1)).get('dn');
}

export default function AddTorrentPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [addMode, setAddMode] = useState<'magnet' | 'file'>('magnet');
  const [magnetLink, setMagnetLink] = useState('');
  const [torrentFile, setTorrentFile] = useState<File | null>(null);
  const [savePath, setSavePath] = useState('');
  const [category, setCategory] = useState(NO_CATEGORY);
  const [startTorrent, setStartTorrent] = useState(true);
  const [linkMedia, setLinkMedia] = useState(false);
  const [mapping, setMapping] = useState<MappingConfig | null>(null);
  const [preflightPlan, setPreflightPlan] = useState<PreflightResult | null>(null);

  // Review step: set once the torrent is added stopped and files can be picked.
  const [reviewHash, setReviewHash] = useState<string | null>(null);

  // File selection review needs torrents.manage (file priorities + start) AND
  // torrents.delete (Cancel removes the added-stopped torrent). Without both,
  // only the previous direct-add behavior is offered.
  const canManage = useCan('torrents.manage');
  const canDelete = useCan('torrents.delete');
  const canAddSeries = useCan('series.add');
  const canAddMovies = useCan('movies.add');
  const canReview = canManage && canDelete;
  const canLinkArr = canAddSeries || canAddMovies;

  const categoriesQuery = useQuery({
    queryKey: ['qbittorrent', 'categories'],
    queryFn: jsonFetcher<Record<string, { name: string; savePath: string }>>('/api/qbittorrent/categories'),
    staleTime: 60_000,
  });
  const categories = useMemo(
    () => Object.values(categoriesQuery.data ?? {}),
    [categoriesQuery.data],
  );
  const selectedCategory = category === NO_CATEGORY ? undefined : category;
  const categorySavePath = categories.find((c) => c.name === selectedCategory)?.savePath;

  const addMutation = useMutation({
    mutationFn: async ({ review }: { review: boolean }) => {
      if (mapping && !review) {
        const payload = {
          mode: 'ARR_MANAGED', service: mapping.service, instanceId: mapping.instanceId,
          media: mapping.media, magnetUrl: magnetLink.trim(),
          torrentName: magnetDisplayName(magnetLink),
        };
        const response = await fetch('/api/manual-downloads', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        const data = await parseApiResult(response);
        if (!response.ok || data.error) throw new ApiError(response.status, data.error || 'Arr did not accept the release');
        return { success: true, manualOverride: data.manualOverride };
      }
      // With review, add .torrent files stopped so files can be deselected
      // before any data downloads. Magnets can't fetch metadata while stopped,
      // so they start with stopCondition=MetadataReceived: qBittorrent stops
      // them automatically once metadata arrives, before downloading data.
      // Direct add skips review and just honors the "Start torrent" checkbox.
      const paused = review ? addMode === 'file' : !startTorrent;

      const res = addMode === 'magnet'
        ? await fetch('/api/qbittorrent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              urls: magnetLink.trim(),
              category: selectedCategory,
              savepath: savePath.trim() || undefined,
              paused,
              stopCondition: review ? 'MetadataReceived' : undefined,
            }),
          })
        : await (() => {
            const formData = new FormData();
            formData.append('file', torrentFile as File);
            if (selectedCategory) formData.append('category', selectedCategory);
            if (savePath.trim()) formData.append('savepath', savePath.trim());
            formData.append('paused', String(paused));
            return fetch('/api/qbittorrent', { method: 'POST', body: formData });
          })();

      const data = await parseApiResult(res);
      // ApiError carries the status so a 401 reaches the global MutationCache
      // handler (redirect); a 200 with success:false toasts as a normal failure.
      if (!res.ok || data.error || data.success !== true) {
        throw new ApiError(res.status, data.error || 'Failed to add torrent');
      }
      return data;
    },
    onSuccess: (data, { review }) => {
      if (review) {
        if (data.hash) {
          setReviewHash(data.hash);
          return;
        }
        // The torrent was added (stopped) but the API returned no hash, so the
        // file-selection step can't run — say so instead of pretending the
        // direct add path was taken.
        toast.warning('Torrent added stopped, but file selection was unavailable');
        router.push('/torrents');
        return;
      }
      toast.success(
        mapping
          ? data.manualOverride
            ? 'Arr policy bypassed; magnet sent to qBittorrent for manual import'
            : 'Release sent to Arr'
          : 'Torrent added',
      );
      router.push('/torrents');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to add torrent');
    },
  });
  const adding = addMutation.isPending;

  const preflightMutation = useMutation({
    mutationFn: async () => {
      if (!mapping) throw new Error('Choose a movie or series first');
      const response = await fetch('/api/manual-downloads/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'ARR_MANAGED', service: mapping.service, instanceId: mapping.instanceId,
          media: mapping.media, magnetUrl: magnetLink.trim(),
        }),
      });
      const data = await response.json().catch(() => ({})) as PreflightResult;
      if (!response.ok || data.error) throw new ApiError(response.status, data.error || 'Preflight failed');
      return data;
    },
    onSuccess: (data) => setPreflightPlan(data),
    onError: (error) => {
      setPreflightPlan(null);
      if (error instanceof ApiError && error.status === 401) return;
      toast.error(error instanceof Error ? error.message : 'Preflight failed');
    },
  });

  function handleAddTorrent(review: boolean) {
    if (addMode === 'magnet' && !magnetLink.trim()) {
      toast.error('Please enter a magnet link');
      return;
    }
    if (addMode === 'file' && !torrentFile) {
      toast.error('Please select a .torrent file');
      return;
    }
    addMutation.mutate({ review });
  }

  function handleArrAction() {
    if (!magnetLink.trim()) {
      toast.error('Please enter a magnet link');
      return;
    }
    if (!mapping) {
      toast.error('Choose a movie or series first');
      return;
    }
    if (!preflightPlan) {
      preflightMutation.mutate();
      return;
    }
    addMutation.mutate({ review: false });
  }

  if (reviewHash) {
    const displayName =
      (addMode === 'magnet'
        ? magnetDisplayName(magnetLink)
        : torrentFile?.name.replace(/\.torrent$/i, '')) || 'New Torrent';
    return (
      <ReviewStep
        hash={reviewHash}
        displayName={displayName}
        startTorrent={startTorrent}
        stopOnMetadata={addMode === 'magnet'}
        mapping={mapping}
      />
    );
  }

  return (
    <div className="space-y-4 animate-content-in">
      <PageHeader title="Add Torrent" />

      <div className="rounded-xl border bg-card p-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Add a torrent via magnet link or .torrent file.
        </p>

        <div className="flex gap-2">
          <Button
            variant={addMode === 'magnet' ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setAddMode('magnet'); setPreflightPlan(null); }}
            className="flex-1"
          >
            <LinkIcon className="mr-2 h-4 w-4" />
            Magnet Link
          </Button>
          <Button
            variant={addMode === 'file' ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setAddMode('file'); setLinkMedia(false); setMapping(null); setPreflightPlan(null); }}
            className="flex-1"
          >
            <FileUp className="mr-2 h-4 w-4" />
            Torrent File
          </Button>
        </div>

        {addMode === 'magnet' ? (
          <Input
            placeholder="magnet:?xt=urn:btih:..."
            value={magnetLink}
            onChange={(e) => { setMagnetLink(e.target.value); setPreflightPlan(null); }}
            autoFocus
          />
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".torrent"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setTorrentFile(file);
              }}
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="mr-2 h-4 w-4" />
              {torrentFile ? torrentFile.name : 'Choose .torrent file'}
            </Button>
          </>
        )}

        {!linkMedia && <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="save-path">
              Save at
            </label>
            <Input
              id="save-path"
              placeholder={categorySavePath || 'qBittorrent default'}
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="category">
              Category
            </label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>None</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={startTorrent}
              onChange={(e) => setStartTorrent(e.target.checked)}
              className="rounded border-border h-4 w-4"
            />
            <span className="text-sm">Start torrent</span>
          </label>
        </div>}

        {addMode === 'magnet' && canLinkArr && (
          <MediaMappingPicker
            canAddSeries={canAddSeries}
            canAddMovies={canAddMovies}
            enabled={linkMedia}
            onEnabledChange={(enabled) => { setLinkMedia(enabled); setPreflightPlan(null); if (!enabled) setMapping(null); }}
            value={mapping}
            onChange={(value) => { setMapping(value); setPreflightPlan(null); }}
          />
        )}

        {preflightPlan && mapping && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm space-y-1">
            <p className="font-medium">Setup check passed</p>
            <p className="text-xs text-muted-foreground">
              {mapping.service === 'SONARR' ? 'Sonarr' : 'Radarr'} will choose from {preflightPlan.downloadClients.length} enabled torrent client{preflightPlan.downloadClients.length === 1 ? '' : 's'} and manage the complete download and import.
            </p>
          </div>
        )}

        <div className="space-y-2 pt-2">
          {canReview && !linkMedia && (
            <Button
              onClick={() => handleAddTorrent(true)}
              disabled={adding || preflightMutation.isPending || (linkMedia && !mapping)}
              className="w-full"
            >
              {adding && addMutation.variables?.review ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                'Next: Choose Files'
              )}
            </Button>
          )}
          <div className="flex gap-2">
            <Button
              variant={canReview ? 'outline' : 'default'}
              onClick={() => linkMedia ? handleArrAction() : handleAddTorrent(false)}
              disabled={adding || preflightMutation.isPending || (linkMedia && !mapping)}
              className="flex-1"
            >
              {adding && !addMutation.variables?.review ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                linkMedia
                  ? preflightMutation.isPending
                    ? 'Checking setup…'
                    : preflightPlan
                      ? 'Send magnet to Arr'
                      : 'Check setup'
                  : 'Add Torrent'
              )}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => router.push('/torrents')}
              disabled={adding}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MediaMappingPicker({
  canAddSeries,
  canAddMovies,
  enabled,
  onEnabledChange,
  value,
  onChange,
}: {
  canAddSeries: boolean;
  canAddMovies: boolean;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  value: MappingConfig | null;
  onChange: (value: MappingConfig | null) => void;
}) {
  const [service, setService] = useState<'SONARR' | 'RADARR'>(canAddMovies ? 'RADARR' : 'SONARR');
  const [instanceId, setInstanceId] = useState('');
  const [term, setTerm] = useState('');
  const [submittedTerm, setSubmittedTerm] = useState('');
  const [profileId, setProfileId] = useState('');
  const [rootFolder, setRootFolder] = useState('');

  const instancesQuery = useQuery({
    queryKey: queryKeys.instances(),
    queryFn: jsonFetcher<Array<{ id: string; type: string; label: string; isDefault: boolean }>>('/api/instances'),
  });
  const instances = useMemo(
    () => (instancesQuery.data ?? []).filter((instance) => instance.type === service),
    [instancesQuery.data, service],
  );
  const effectiveInstanceId = instances.some((instance) => instance.id === instanceId)
    ? instanceId
    : instances.find((instance) => instance.isDefault)?.id ?? instances[0]?.id ?? '';
  const arrService = service === 'SONARR' ? 'sonarr' : 'radarr';
  const { data: profiles = [] } = useQualityProfiles(arrService, effectiveInstanceId || undefined);
  const { data: rootFolders = [] } = useRootFolders(arrService, effectiveInstanceId || undefined);
  const effectiveProfileId = profiles.some((profile) => String(profile.id) === profileId)
    ? profileId : profiles[0] ? String(profiles[0].id) : '';
  const effectiveRootFolder = rootFolders.some((folder) => folder.path === rootFolder)
    ? rootFolder : rootFolders[0]?.path ?? '';
  const lookupQuery = useQuery({
    queryKey: [arrService, 'lookup', effectiveInstanceId, submittedTerm],
    queryFn: jsonFetcher<Array<SonarrLookupResult | RadarrLookupResult>>(
      `/api/${arrService}/lookup?term=${encodeURIComponent(submittedTerm)}`,
      effectiveInstanceId,
    ),
    enabled: enabled && Boolean(effectiveInstanceId && submittedTerm.trim()),
  });

  function choose(item: SonarrLookupResult | RadarrLookupResult) {
    if (item.library?.exists) {
      toast.error(`${item.title} already exists in the selected ${service === 'SONARR' ? 'Sonarr' : 'Radarr'} instance`);
      return;
    }
    if (!effectiveProfileId || !effectiveRootFolder) {
      toast.error('The selected instance needs a quality profile and root folder');
      return;
    }
    const media = service === 'SONARR'
      ? {
          ...item,
          qualityProfileId: Number(effectiveProfileId),
          rootFolderPath: effectiveRootFolder,
          monitored: true,
          monitor: 'all',
          seasonFolder: true,
          seriesType: 'standard',
        }
      : {
          ...item,
          qualityProfileId: Number(effectiveProfileId),
          rootFolderPath: effectiveRootFolder,
          monitored: true,
          minimumAvailability: 'released',
        };
    onChange({ service, instanceId: effectiveInstanceId, media, title: item.title });
  }

  const posterHint = service === 'SONARR' ? 'sonarr' : 'radarr';
  const PosterFallback = service === 'SONARR' ? Tv : Film;

  function posterUrl(images: MediaImage[] | undefined) {
    const remote = images?.find((image) => image.coverType === 'poster')?.remoteUrl;
    return remote ? toCachedImageSrc(remote, posterHint) : null;
  }

  function isSelected(item: SonarrLookupResult | RadarrLookupResult) {
    if (!value || value.service !== service || value.instanceId !== effectiveInstanceId) return false;
    const slug = typeof value.media.titleSlug === 'string' ? value.media.titleSlug : null;
    return slug === item.titleSlug;
  }

  const linkedPoster = value
    ? posterUrl(Array.isArray(value.media.images) ? (value.media.images as MediaImage[]) : undefined)
    : null;

  return (
    <div className="rounded-xl border bg-card p-3 space-y-3">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} className="h-4 w-4 rounded border-border" />
        <span className="text-sm font-medium">Link to Sonarr or Radarr</span>
      </label>
      {enabled && (
        <div className="space-y-3 border-t pt-3">
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>Recommended: Sonarr or Radarr receives the magnet, chooses its download client, and owns queueing, import, rename, and library placement.</p>
            {service === 'SONARR' && <p>Sonarr reads the magnet release name to determine whether it contains one episode, multiple episodes, or a full season pack.</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={service} onValueChange={(next: 'SONARR' | 'RADARR') => { setService(next); setInstanceId(''); onChange(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {canAddMovies && <SelectItem value="RADARR">Radarr</SelectItem>}
                {canAddSeries && <SelectItem value="SONARR">Sonarr</SelectItem>}
              </SelectContent>
            </Select>
            <Select value={effectiveInstanceId} onValueChange={(next) => { setInstanceId(next); onChange(null); }}>
              <SelectTrigger><SelectValue placeholder="Instance" /></SelectTrigger>
              <SelectContent>{instances.map((instance) => <SelectItem key={instance.id} value={instance.id}>{instance.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); onChange(null); setSubmittedTerm(term.trim()); }}>
            <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder={`Search ${service === 'SONARR' ? 'series' : 'movies'}…`} />
            <Button type="submit" variant="outline" disabled={!term.trim() || !effectiveInstanceId}>Search</Button>
          </form>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label className="text-xs">Quality profile</Label><Select value={effectiveProfileId} onValueChange={(next) => { setProfileId(next); onChange(null); }}><SelectTrigger><SelectValue placeholder="Profile" /></SelectTrigger><SelectContent>{profiles.map((profile) => <SelectItem key={profile.id} value={String(profile.id)}>{profile.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label className="text-xs">Root folder</Label><Select value={effectiveRootFolder} onValueChange={(next) => { setRootFolder(next); onChange(null); }}><SelectTrigger><SelectValue placeholder="Folder" /></SelectTrigger><SelectContent>{rootFolders.map((folder) => <SelectItem key={folder.path} value={folder.path}>{folder.path}</SelectItem>)}</SelectContent></Select></div>
          </div>
          {lookupQuery.isFetching && <p className="text-xs text-muted-foreground">Searching…</p>}
          <div className="space-y-2">
            {(lookupQuery.data ?? []).slice(0, 8).map((item, index) => {
              const poster = posterUrl(item.images);
              const selected = isSelected(item);
              return (
                <button
                  key={`${service}-${item.titleSlug}`}
                  type="button"
                  onClick={() => choose(item)}
                  disabled={item.library?.exists}
                  aria-pressed={selected}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border p-2 text-left text-sm transition-colors disabled:opacity-50',
                    selected
                      ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                      : 'hover:bg-muted/40',
                  )}
                >
                  <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                    {poster ? (
                      <FadeInImage
                        src={poster}
                        alt=""
                        fill
                        sizes="40px"
                        priority={index < 4}
                        className="object-cover"
                        unoptimized={isProtectedApiImageSrc(poster)}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <PosterFallback className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {item.title}{' '}
                      <span className="font-normal text-muted-foreground">({item.year})</span>
                    </p>
                    {item.library?.exists && (
                      <p className="text-xs text-muted-foreground">Already in library</p>
                    )}
                  </div>
                  {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
          {value && !(lookupQuery.data ?? []).some((item) => isSelected(item)) && (
            <div className="flex items-center gap-3 rounded-lg border border-primary/50 bg-primary/10 p-2 text-sm ring-1 ring-primary/30">
              <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                {linkedPoster ? (
                  <FadeInImage
                    src={linkedPoster}
                    alt=""
                    fill
                    sizes="40px"
                    className="object-cover"
                    unoptimized={isProtectedApiImageSrc(linkedPoster)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <PosterFallback className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </div>
              <p className="min-w-0 flex-1">
                Linked to <span className="font-medium">{value.title}</span>
              </p>
              <Check className="h-4 w-4 shrink-0 text-primary" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewStep({
  hash,
  displayName,
  startTorrent,
  stopOnMetadata,
  mapping,
}: {
  hash: string;
  displayName: string;
  startTorrent: boolean;
  stopOnMetadata: boolean;
  mapping: MappingConfig | null;
}) {
  const router = useRouter();
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  // null = untouched; top-level folders render expanded by default.
  const [expandedDirs, setExpandedDirs] = useState<Set<string> | null>(null);
  const [fileFilter, setFileFilter] = useState('');

  // Poll for files until metadata arrives (magnets fetch metadata even while
  // stopped); once the file list exists it's static, so polling stops.
  const filesQuery = useQuery({
    queryKey: ['qbittorrent', hash, 'add-review-files'],
    queryFn: jsonFetcher<{ files: TorrentFile[] }>(`/api/qbittorrent/${hash}/files`),
    select: (d) => d.files ?? [],
    refetchInterval: (query) => ((query.state.data?.files?.length ?? 0) > 0 ? false : 1500),
    refetchIntervalInBackground: false,
  });
  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);
  const hasMetadata = files.length > 0;

  // Magnets fetch metadata while running (stopped torrents can't). qBittorrent
  // 4.6+ auto-stops via stopCondition=MetadataReceived; this covers older
  // versions by stopping as soon as the file list first appears. The request
  // promise is kept so confirm can await it — otherwise a late-landing stop
  // could re-stop a torrent the user just started.
  const stopPendingRef = useRef(stopOnMetadata);
  const stopRequestRef = useRef<Promise<void> | null>(null);
  useEffect(() => {
    if (!hasMetadata || !stopPendingRef.current) return;
    stopPendingRef.current = false;
    stopRequestRef.current = fetch(`/api/qbittorrent/${hash}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    }).then(
      () => undefined,
      () => undefined, // best effort — confirm still applies priorities
    );
  }, [hasMetadata, hash]);

  const defaultExpandedDirs = useMemo(() => {
    const roots = new Set<string>();
    for (const f of files) {
      const slash = f.name.indexOf('/');
      if (slash > 0) roots.add(f.name.slice(0, slash));
    }
    return roots;
  }, [files]);
  const effectiveExpandedDirs = expandedDirs ?? defaultExpandedDirs;

  const filterText = fileFilter.trim().toLowerCase();
  const tree = useMemo(() => {
    const visible = filterText
      ? files.filter((f) => f.name.toLowerCase().includes(filterText))
      : files;
    // Reuse the shared tree helpers by expressing local selection as priority.
    return buildFileTree(
      visible.map((f) => ({ ...f, priority: excluded.has(f.index) ? 0 : 1 })),
    );
  }, [files, excluded, filterText]);

  const selectedCount = files.length - excluded.size;
  const selectedSize = useMemo(
    () => files.reduce((sum, f) => (excluded.has(f.index) ? sum : sum + f.size), 0),
    [files, excluded],
  );

  const setSelected = useCallback((indices: number[], selected: boolean) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const index of indices) {
        if (selected) next.delete(index);
        else next.add(index);
      }
      return next;
    });
  }, []);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev ?? defaultExpandedDirs);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, [defaultExpandedDirs]);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      // Let the fallback stop settle first so it can't land after our start.
      if (stopRequestRef.current) await stopRequestRef.current;
      if (excluded.size > 0) {
        const res = await fetch(`/api/qbittorrent/${hash}/files/priority`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [...excluded], priority: 0 }),
        });
        if (!res.ok) {
          const data = await parseApiResult(res);
          throw new ApiError(res.status, data.error || 'Failed to skip deselected files');
        }
      }
      if (mapping) {
        const res = await fetch('/api/manual-downloads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'QBIT_REVIEWED',
            torrentHash: hash,
            service: mapping.service,
            instanceId: mapping.instanceId,
            media: mapping.media,
            selectedFileIds: files.filter((file) => !excluded.has(file.index)).map((file) => file.index),
          }),
        });
        if (!res.ok) {
          const data = await parseApiResult(res);
          throw new ApiError(res.status, data.error || 'Failed to link torrent');
        }
      }
      if (startTorrent) {
        const res = await fetch(`/api/qbittorrent/${hash}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' }),
        });
        if (!res.ok) {
          const data = await parseApiResult(res);
          throw new ApiError(res.status, data.error || 'Failed to start torrent');
        }
      }
    },
    onSuccess: () => {
      toast.success('Torrent added');
      router.push('/torrents');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to add torrent');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/qbittorrent/${hash}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', deleteFiles: false }),
      });
      if (!res.ok) {
        const data = await parseApiResult(res);
        throw new ApiError(res.status, data.error || 'Failed to remove torrent');
      }
    },
    onSuccess: () => {
      toast.success('Torrent removed');
      router.push('/torrents');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to remove torrent');
    },
  });

  const busy = confirmMutation.isPending || cancelMutation.isPending;

  return (
    <div className="space-y-3 animate-content-in">
      <PageHeader title="Choose Files" subtitle={displayName} showBack={false} />

      {mapping && (
        <div className="rounded-xl border bg-card p-3 text-sm">
          <span className="text-muted-foreground">Import after completion into </span>
          <span className="font-medium">{mapping.title}</span>
          <span className="text-muted-foreground"> via {mapping.service === 'SONARR' ? 'Sonarr' : 'Radarr'}</span>
        </div>
      )}

      {!hasMetadata ? (
        <div className="rounded-xl border bg-card p-8 flex flex-col items-center gap-3 text-center">
          {filesQuery.isError ? (
            <p className="text-sm text-muted-foreground">
              {filesQuery.error instanceof Error ? filesQuery.error.message : 'Failed to fetch files'}
            </p>
          ) : (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Retrieving metadata from peers…</p>
              <p className="text-xs text-muted-foreground">
                The torrent stops once metadata arrives so you can pick files before downloading.
              </p>
            </>
          )}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => cancelMutation.mutate()}
            disabled={busy}
          >
            {cancelMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancel
          </Button>
        </div>
      ) : (
        <>
          {/* Selection summary + bulk controls */}
          <div className="rounded-xl bg-card p-3 space-y-2.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {selectedCount} of {files.length} file{files.length !== 1 ? 's' : ''} selected
              </span>
              <span>{formatBytes(selectedSize)}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setExcluded(new Set())}
              >
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setExcluded(new Set(files.map((f) => f.index)))}
              >
                Select None
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Filter files..."
                value={fileFilter}
                onChange={(e) => setFileFilter(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>

          {/* File tree */}
          <div className="rounded-xl bg-card overflow-hidden">
            {tree.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">No files match the filter</p>
            ) : (
              tree.map((node) => (
                <ReviewNodeRow
                  key={node.type === 'file' ? `f-${node.file.index}` : `d-${node.path}`}
                  node={node}
                  depth={0}
                  expandedDirs={effectiveExpandedDirs}
                  forceExpand={filterText.length > 0}
                  onToggleDir={toggleDir}
                  onSetSelected={setSelected}
                />
              ))
            )}
          </div>

          <div className="flex gap-2 pb-4">
            <Button
              className="flex-1"
              onClick={() => confirmMutation.mutate()}
              disabled={busy || selectedCount === 0}
            >
              {confirmMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : startTorrent ? (
                'Add & Start'
              ) : (
                'Add Stopped'
              )}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => cancelMutation.mutate()}
              disabled={busy}
            >
              {cancelMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

interface ReviewNodeRowProps {
  node: TreeNode;
  depth: number;
  expandedDirs: Set<string>;
  forceExpand: boolean;
  onToggleDir: (path: string) => void;
  onSetSelected: (indices: number[], selected: boolean) => void;
}

function ReviewNodeRow(props: ReviewNodeRowProps) {
  if (props.node.type === 'file') {
    return <ReviewFileRow node={props.node} depth={props.depth} onSetSelected={props.onSetSelected} />;
  }
  return <ReviewDirRow {...props} node={props.node} />;
}

function ReviewDirRow({
  node,
  depth,
  expandedDirs,
  forceExpand,
  onToggleDir,
  onSetSelected,
}: ReviewNodeRowProps & { node: DirNode }) {
  const expanded = forceExpand || expandedDirs.has(node.path);
  const checkState = getCheckState(node);
  const indent = Math.min(depth, 4) * 16;

  return (
    <>
      <div className="border-b border-border/50">
        <div
          className="flex items-center gap-2 px-3 py-2.5"
          style={{ paddingLeft: `${12 + indent}px` }}
        >
          <input
            type="checkbox"
            checked={checkState === 'all'}
            aria-label={`Select ${node.name}`}
            ref={(el) => {
              if (el) el.indeterminate = checkState === 'indeterminate';
            }}
            onChange={() => onSetSelected(getAllFileIndices(node), checkState !== 'all')}
            className="rounded border-border h-4 w-4 shrink-0"
          />

          <button
            className="flex items-center gap-1.5 min-w-0 flex-1"
            onClick={() => onToggleDir(node.path)}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium truncate">{node.name}</span>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {node.selectedCount}/{node.fileCount}
            </span>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {formatBytes(node.totalSize)}
            </span>
          </div>
        </div>
      </div>

      {expanded &&
        node.children.map((child) => (
          <ReviewNodeRow
            key={child.type === 'file' ? `f-${child.file.index}` : `d-${child.path}`}
            node={child}
            depth={depth + 1}
            expandedDirs={expandedDirs}
            forceExpand={forceExpand}
            onToggleDir={onToggleDir}
            onSetSelected={onSetSelected}
          />
        ))}
    </>
  );
}

function ReviewFileRow({
  node,
  depth,
  onSetSelected,
}: {
  node: FileNode;
  depth: number;
  onSetSelected: (indices: number[], selected: boolean) => void;
}) {
  const { file } = node;
  const isSelected = file.priority > 0;
  const indent = Math.min(depth, 4) * 16;

  return (
    <div className="border-b border-border/50">
      <label
        className="flex items-start gap-2 px-3 py-2.5 cursor-pointer"
        style={{ paddingLeft: `${12 + indent}px` }}
      >
        <input
          type="checkbox"
          checked={isSelected}
          aria-label={`Select ${node.name}`}
          onChange={() => onSetSelected([file.index], !isSelected)}
          className="rounded border-border h-4 w-4 mt-0.5 shrink-0"
        />
        <File className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
        <span className="text-xs break-all line-clamp-2 leading-snug flex-1">{node.name}</span>
        <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
          {formatBytes(file.size)}
        </span>
      </label>
    </div>
  );
}
