'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Loader2, Pencil, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/page-spinner';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from '@/components/ui/drawer';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DeleteFilesConfirmDrawer } from '@/components/media/delete-files-confirm-drawer';
import { jsonFetcher, ensureArray, withInstanceQuery, arrMutationFetch, ApiError } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { invalidateSeries, invalidateMovies } from '@/lib/query-invalidation';
import {
  useQualityDefinitions, useLanguages, useMediaManagementConfig,
} from '@/lib/hooks/use-reference-data';
import { pollCommand } from '@/lib/arr-command';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/lib/store';
import { useCan } from '@/components/permission-provider';
import type {
  ManualImportItem, SonarrEpisode, ArrLanguage, ArrQualityModel, ReleaseType,
} from '@/types';

type Service = 'sonarr' | 'radarr';

// Per-row edits made in the modal; null fields = "use the scanned value".
interface RowOverride {
  episodes?: SonarrEpisode[];
  seasonNumber?: number;
  quality?: ArrQualityModel;
  languages?: ArrLanguage[];
  releaseGroup?: string;
  releaseType?: ReleaseType;
  indexerFlags?: number;
}

type BulkProp = 'season' | 'episodes' | 'quality' | 'releaseGroup' | 'language' | 'releaseType' | 'indexerFlags';

const RELEASE_TYPES: { value: ReleaseType; label: string }[] = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'singleEpisode', label: 'Single Episode' },
  { value: 'multiEpisode', label: 'Multi Episode' },
  { value: 'seasonPack', label: 'Season Pack' },
];

// IndexerFlags are a bitfield. Values are verified from each app's
// Parser/Model/IndexerFlags.cs and DIFFER between Sonarr and Radarr.
const INDEXER_FLAGS: Record<Service, { label: string; value: number }[]> = {
  sonarr: [
    { label: 'Freeleech', value: 1 }, { label: 'Halfleech', value: 2 },
    { label: 'Double Upload', value: 4 }, { label: 'Internal', value: 8 },
    { label: 'Scene', value: 16 }, { label: 'Freeleech 75%', value: 32 },
    { label: 'Freeleech 25%', value: 64 }, { label: 'Nuked', value: 128 },
    { label: 'Subtitles', value: 256 },
  ],
  radarr: [
    { label: 'Freeleech', value: 1 }, { label: 'Halfleech', value: 2 },
    { label: 'Double Upload', value: 4 }, { label: 'Golden', value: 8 },
    { label: 'Approved', value: 16 }, { label: 'Internal', value: 32 },
    { label: 'Scene', value: 128 }, { label: 'Freeleech 75%', value: 256 },
    { label: 'Freeleech 25%', value: 512 }, { label: 'Nuked', value: 2048 },
  ],
};

function epLabel(eps: SonarrEpisode[]): string {
  if (!eps.length) return '';
  const s = String(eps[0].seasonNumber).padStart(2, '0');
  return `S${s}E${eps.map((e) => String(e.episodeNumber).padStart(2, '0')).join(', E')}`;
}

// Display the scanned files ordered by season then episode (loose files last),
// falling back to the path so the order is stable across scans.
function sortManualImportItems(items: ManualImportItem[]): ManualImportItem[] {
  return [...items].sort((a, b) => {
    const aEps = a.episodes ?? [];
    const bEps = b.episodes ?? [];
    const aSeason = aEps.length ? aEps[0].seasonNumber : a.seasonNumber ?? Number.MAX_SAFE_INTEGER;
    const bSeason = bEps.length ? bEps[0].seasonNumber : b.seasonNumber ?? Number.MAX_SAFE_INTEGER;
    if (aSeason !== bSeason) return aSeason - bSeason;
    const aEp = aEps.length ? Math.min(...aEps.map((e) => e.episodeNumber)) : Number.MAX_SAFE_INTEGER;
    const bEp = bEps.length ? Math.min(...bEps.map((e) => e.episodeNumber)) : Number.MAX_SAFE_INTEGER;
    if (aEp !== bEp) return aEp - bEp;
    return (a.relativePath || a.name || '').localeCompare(b.relativePath || b.name || '');
  });
}

interface ManageMediaFlowProps {
  service: Service;
  mediaId: number;
  mediaTitle: string;
  instanceId?: string;
}

export function ManageMediaFlow({ service, mediaId, mediaTitle, instanceId }: ManageMediaFlowProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isSonarr = service === 'sonarr';
  const navPosition = useUIStore((s) => s.navPosition);
  const canDelete = useCan(isSonarr ? 'series.delete' : 'movies.delete');
  const canImportFiles = useCan('activity.manage');

  // Selection + per-row edits are keyed by the file's PATH (stable), not its
  // array index — the scan can refetch with a different file set (Refresh, or
  // after a delete), and an index would then target the wrong file.
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [overrides, setOverrides] = React.useState<Map<string, RowOverride>>(new Map());
  const [bulkMenuOpen, setBulkMenuOpen] = React.useState(false);
  const [activePicker, setActivePicker] = React.useState<BulkProp | null>(null);
  const [episodeView, setEpisodeView] = React.useState(false); // full-screen episode picker
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const scanPath = isSonarr
    ? `/api/sonarr/manualimport/scan?seriesId=${mediaId}`
    : `/api/radarr/manualimport/scan?movieId=${mediaId}`;

  const { data: files = [], isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['manage-scan', service, instanceId ?? 'default', mediaId],
    queryFn: jsonFetcher<ManualImportItem[]>(scanPath, instanceId),
    select: (d) => sortManualImportItems(ensureArray(d)),
  });

  const episodesKey = queryKeys.episodes(mediaId, instanceId);
  const { data: allEpisodes = [] } = useQuery({
    queryKey: episodesKey,
    queryFn: jsonFetcher<SonarrEpisode[]>(withInstanceQuery(`/api/sonarr/${mediaId}/episodes`, instanceId)),
    enabled: isSonarr,
    select: ensureArray,
  });

  const qualityDefsQuery = useQualityDefinitions(service, instanceId);
  const languagesQuery = useLanguages(service, instanceId);
  const configQuery = useMediaManagementConfig(service, instanceId);
  const config = configQuery.isError ? null : configQuery.data;

  React.useEffect(() => {
    if (isError) toast.error('Failed to scan for files');
  }, [isError]);

  // ── effective value getters (override wins over the scanned value) ──────────
  const ov = (f: ManualImportItem): RowOverride => overrides.get(f.path) ?? {};
  const episodesOf = (f: ManualImportItem) => ov(f).episodes ?? f.episodes ?? [];
  const qualityOf = (f: ManualImportItem) => ov(f).quality ?? f.quality;
  const languagesOf = (f: ManualImportItem): ArrLanguage[] => ov(f).languages ?? f.languages ?? [];
  const releaseGroupOf = (f: ManualImportItem) => ov(f).releaseGroup ?? f.releaseGroup;
  const releaseTypeOf = (f: ManualImportItem) => ov(f).releaseType ?? f.releaseType;
  const indexerFlagsOf = (f: ManualImportItem) => ov(f).indexerFlags ?? f.indexerFlags;
  const fileIdOf = (f: ManualImportItem) => (isSonarr ? f.episodeFileId : f.movieFileId);

  // A Sonarr row's episode mapping changed if the user remapped season/episodes.
  function mappingChanged(f: ManualImportItem): boolean {
    const o = ov(f);
    if (o.seasonNumber !== undefined && o.seasonNumber !== f.seasonNumber) return true;
    if (o.episodes) {
      const orig = (f.episodes ?? []).map((e) => e.id).sort().join(',');
      const next = o.episodes.map((e) => e.id).sort().join(',');
      return orig !== next;
    }
    return false;
  }

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === files.length ? new Set() : new Set(files.map((f) => f.path))));
  }

  function applyToSelected(patch: RowOverride) {
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const path of selected) next.set(path, { ...next.get(path), ...patch });
      return next;
    });
  }

  function invalidateAfter() {
    queryClient.invalidateQueries({ queryKey: ['manage-scan', service, instanceId ?? 'default', mediaId] });
    if (isSonarr) invalidateSeries(queryClient, { itemId: mediaId, instanceId });
    else invalidateMovies(queryClient, { itemId: mediaId, instanceId });
  }

  const selectedFiles = files.filter((f) => selected.has(f.path));
  const deletableSelected = selectedFiles.filter((f) => fileIdOf(f));
  const deletableBytes = deletableSelected.reduce((s, f) => s + (f.size ?? 0), 0);

  // ── Commit: two-bucket split, mirroring the *arr UI ─────────────────────────
  async function commit() {
    if (selectedFiles.length === 0) return;

    const existingEdits: Record<string, unknown>[] = [];
    const importFiles: Record<string, unknown>[] = [];

    for (const f of selectedFiles) {
      const fileId = fileIdOf(f);

      if (fileId && (!isSonarr || !mappingChanged(f))) {
        // Bucket 1 — unchanged imported file → metadata-only bulk edit. Send ONLY
        // the fields the user actually changed (the override), so an untouched
        // selected file produces no write.
        const o = ov(f);
        const edit: Record<string, unknown> = { id: fileId };
        if (o.quality !== undefined) edit.quality = o.quality;
        if (o.languages !== undefined) edit.languages = o.languages;
        if (o.releaseGroup !== undefined) edit.releaseGroup = o.releaseGroup;
        if (o.indexerFlags !== undefined) edit.indexerFlags = o.indexerFlags;
        if (isSonarr && o.releaseType !== undefined) edit.releaseType = o.releaseType;
        if (Object.keys(edit).length > 1) existingEdits.push(edit);
      } else {
        // Bucket 2 — loose file or re-mapped existing file → ManualImport.
        // Imports carry the effective (override-or-scanned) values.
        if (isSonarr) {
          const eps = episodesOf(f);
          if (eps.length === 0) {
            toast.error(`Assign an episode for "${f.name || f.relativePath}" before importing`);
            return;
          }
          importFiles.push({
            path: f.path, episodeIds: eps.map((e) => e.id), seasonNumber: eps[0]?.seasonNumber,
            quality: qualityOf(f), languages: languagesOf(f), releaseGroup: releaseGroupOf(f),
            indexerFlags: indexerFlagsOf(f), releaseType: releaseTypeOf(f),
          });
        } else {
          importFiles.push({
            path: f.path, quality: qualityOf(f), languages: languagesOf(f),
            releaseGroup: releaseGroupOf(f), indexerFlags: indexerFlagsOf(f),
          });
        }
      }
    }

    if (importFiles.length && !canImportFiles) {
      toast.error('Importing files requires the “Manage queue” permission.');
      return;
    }
    if (existingEdits.length === 0 && importFiles.length === 0) {
      toast.info('No changes to apply.');
      return;
    }

    setSubmitting(true);
    try {
      const idKey = isSonarr ? 'seriesId' : 'movieId';
      const bulkPath = isSonarr ? '/api/sonarr/episodefile' : '/api/radarr/moviefile';
      const importPath = isSonarr ? '/api/sonarr/manualimport/import' : '/api/radarr/manualimport/import';

      if (existingEdits.length) {
        const res = await arrMutationFetch(instanceId, bulkPath, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [idKey]: mediaId, mediaTitle, edits: existingEdits }),
        });
        if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error || 'Edit failed');
      }
      if (importFiles.length) {
        const res = await arrMutationFetch(instanceId, importPath, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [idKey]: mediaId, mediaTitle, files: importFiles }),
        });
        if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error || 'Import failed');
        const { commandId } = (await res.json()) as { commandId: number };
        toast.loading('Importing…', { id: 'manage-commit' });
        const status = await pollCommand(service, commandId, instanceId);
        if (status === 'timeout') {
          // The import is queued but hasn't finished within the poll window — don't
          // claim success. Surface it and let the user track it in Activity.
          toast.warning('Import is still running — check Activity for the result.', { id: 'manage-commit' });
          invalidateAfter();
          router.back();
          return;
        }
        if (status !== 'completed') throw new ApiError(500, 'Import failed');
      }
      const total = existingEdits.length + importFiles.length;
      toast.success(`Updated ${total} file${total === 1 ? '' : 's'}`, { id: 'manage-commit' });
      invalidateAfter();
      router.back();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to apply changes', { id: 'manage-commit' });
    } finally {
      setSubmitting(false);
    }
  }

  async function doDelete() {
    const ids = deletableSelected.map((f) => fileIdOf(f)).filter((x): x is number => !!x);
    if (!ids.length) return;
    setSubmitting(true);
    try {
      const idKey = isSonarr ? 'seriesId' : 'movieId';
      const idsKey = isSonarr ? 'episodeFileIds' : 'movieFileIds';
      const path = isSonarr ? '/api/sonarr/episodefile' : '/api/radarr/moviefile';
      const res = await arrMutationFetch(instanceId, path, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [idKey]: mediaId, mediaTitle, [idsKey]: ids }),
      });
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error || 'Delete failed');
      toast.success(`Deleted ${ids.length} file${ids.length === 1 ? '' : 's'}`);
      setDeleteOpen(false);
      setSelected(new Set());
      invalidateAfter();
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete files');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Episode picker (full-screen sub-view, Sonarr) ───────────────────────────
  if (episodeView) {
    return (
      <EpisodePicker
        episodes={allEpisodes}
        initial={selectedFiles.length === 1 ? episodesOf(selectedFiles[0]) : []}
        onCancel={() => setEpisodeView(false)}
        onConfirm={(eps) => {
          applyToSelected({ episodes: eps, seasonNumber: eps[0]?.seasonNumber });
          setEpisodeView(false);
        }}
      />
    );
  }

  const bulkOptions: { prop: BulkProp; label: string }[] = isSonarr
    ? [
        { prop: 'season', label: 'Select Season' },
        { prop: 'episodes', label: 'Select Episode(s)' },
        { prop: 'quality', label: 'Select Quality' },
        { prop: 'releaseGroup', label: 'Select Release Group' },
        { prop: 'language', label: 'Select Language' },
        { prop: 'indexerFlags', label: 'Select Indexer Flags' },
        { prop: 'releaseType', label: 'Select Release Type' },
      ]
    : [
        { prop: 'quality', label: 'Select Quality' },
        { prop: 'releaseGroup', label: 'Select Release Group' },
        { prop: 'language', label: 'Select Language' },
        { prop: 'indexerFlags', label: 'Select Indexer Flags' },
      ];

  const allSelected = files.length > 0 && selected.size === files.length;
  const someSelected = selected.size > 0 && selected.size < files.length;

  return (
    <div className="animate-content-in">
      <PageHeader
        title={isSonarr ? 'Manage Episodes' : 'Manage Files'}
        subtitle={mediaTitle}
        onBack={() => router.back()}
        rightContent={
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()} disabled={isRefetching}>
            {isRefetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        }
      />

      {files.length > 0 && (
        <div
          className="sticky z-30 -mx-2 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-2 backdrop-blur-sm md:-mx-6 md:px-6"
          style={{ top: 'calc(var(--header-height, 0px) + 2.75rem)' }}
        >
          <Checkbox
            checked={allSelected ? true : someSelected ? 'indeterminate' : false}
            onCheckedChange={toggleAll}
            aria-label="Select all"
          />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {selected.size > 0 ? `${selected.size} of ${files.length} selected` : `${files.length} files`}
          </span>
        </div>
      )}

      <div className="pb-4">
        {isLoading ? (
          <PageSpinner />
        ) : files.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">No files found in the folder.</div>
        ) : (
          <div className="space-y-2 py-3">
            {files.map((f) => {
              const checked = selected.has(f.path);
              const eps = episodesOf(f);
              const fileId = fileIdOf(f);
              const q = qualityOf(f);
              const langs = languagesOf(f);
              const rg = releaseGroupOf(f);
              const hasRej = f.rejections.length > 0;
              return (
                <div
                  key={f.path}
                  className={cn('overflow-hidden rounded-xl border bg-muted/30', checked ? 'border-primary/60' : 'border-border/40')}
                >
                  <button type="button" data-testid="manage-file-card" onClick={() => toggle(f.path)} className="flex w-full items-start gap-3 p-3.5 text-left">
                    <span aria-hidden className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="break-words text-sm leading-snug">{f.relativePath || f.name}</p>
                      <div className="flex flex-wrap items-center gap-1">
                        {q?.quality?.name && <Badge variant="secondary" className="text-[10px]">{q.quality.name}</Badge>}
                        {langs.length > 0 && <Badge variant="outline" className="text-[10px]">{langs.map((l) => l.name).join(', ')}</Badge>}
                        {rg && <Badge variant="outline" className="text-[10px]">{rg}</Badge>}
                        <Badge variant="outline" className="text-[10px]">{formatBytes(f.size)}</Badge>
                        {f.customFormatScore !== undefined && f.customFormatScore !== 0 && (
                          <Badge variant="outline" className="text-[10px]">
                            {f.customFormatScore > 0 ? `+${f.customFormatScore}` : f.customFormatScore}
                          </Badge>
                        )}
                        {fileId ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">In library</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-primary">New file</Badge>
                        )}
                      </div>
                      {hasRej && (
                        <div className="space-y-0.5 text-xs text-destructive">
                          {f.rejections.map((r, ri) => <p key={ri}>{r.reason}</p>)}
                        </div>
                      )}
                    </div>
                  </button>
                  {isSonarr && (
                    <div className="flex w-full items-center gap-2 border-t border-border/30 bg-muted/20 px-3.5 py-2.5">
                      <div className="min-w-0 flex-1 text-left">
                        {eps.length > 0 ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="shrink-0 text-[10px]">{epLabel(eps)}</Badge>
                            <span className="truncate text-xs text-muted-foreground">{eps[0].title || 'TBA'}</span>
                          </div>
                        ) : (
                          <span className="text-xs font-medium text-destructive">No episode mapped</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom action bar — always visible; actions enable once files are selected */}
      <div
        className={cn(
          'sticky z-30 -mx-2 flex items-center gap-2 border-t border-border bg-background/95 px-3 py-3 backdrop-blur-sm md:-mx-6 md:px-6',
          navPosition === 'bottom' ? 'bottom-[calc(3rem+env(safe-area-inset-bottom))] md:bottom-0' : 'bottom-0'
        )}
      >
        {canDelete && (
          <Button variant="destructive" size="sm" disabled={submitting || deletableSelected.length === 0} onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1.5 h-4 w-4" />Delete
          </Button>
        )}
        <Button variant="outline" size="sm" className="flex-1" disabled={submitting || selected.size === 0} onClick={() => setBulkMenuOpen(true)}>
          <Pencil className="mr-1.5 h-4 w-4" />Select…
        </Button>
        <Button size="sm" className="flex-1" disabled={submitting || selected.size === 0} onClick={commit}>
          {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Import
        </Button>
      </div>

      {/* Bulk "Select…" property menu */}
      <Drawer open={bulkMenuOpen} onOpenChange={setBulkMenuOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Edit {selected.size} {selected.size === 1 ? 'file' : 'files'}</DrawerTitle>
            <DrawerDescription className="sr-only">Choose a property to set on the selected files.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {bulkOptions.map((o) => (
              <button
                key={o.prop}
                className="flex w-full items-center justify-between border-b border-border/40 px-1 py-3.5 text-left text-sm active:bg-muted/40"
                onClick={() => {
                  setBulkMenuOpen(false);
                  if (o.prop === 'episodes') setEpisodeView(true);
                  else setActivePicker(o.prop);
                }}
              >
                {o.label}
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>

      <SeasonPicker
        open={activePicker === 'season'}
        episodes={allEpisodes}
        onClose={() => setActivePicker(null)}
        onSelect={(season) => { applyToSelected({ seasonNumber: season, episodes: [] }); setActivePicker(null); }}
      />
      <QualityPicker
        open={activePicker === 'quality'}
        defs={qualityDefsQuery.data ?? []}
        loading={qualityDefsQuery.isLoading}
        onClose={() => setActivePicker(null)}
        onSelect={(quality) => { applyToSelected({ quality }); setActivePicker(null); }}
      />
      <ReleaseGroupPicker
        open={activePicker === 'releaseGroup'}
        onClose={() => setActivePicker(null)}
        onSelect={(rg) => { applyToSelected({ releaseGroup: rg }); setActivePicker(null); }}
      />
      <LanguagePicker
        open={activePicker === 'language'}
        languages={languagesQuery.data ?? []}
        loading={languagesQuery.isLoading}
        onClose={() => setActivePicker(null)}
        onSelect={(langs) => { applyToSelected({ languages: langs }); setActivePicker(null); }}
      />
      <IndexerFlagsPicker
        open={activePicker === 'indexerFlags'}
        options={INDEXER_FLAGS[service]}
        onClose={() => setActivePicker(null)}
        onSelect={(flags) => { applyToSelected({ indexerFlags: flags }); setActivePicker(null); }}
      />
      {isSonarr && (
        <ReleaseTypePicker
          open={activePicker === 'releaseType'}
          onClose={() => setActivePicker(null)}
          onSelect={(rt) => { applyToSelected({ releaseType: rt }); setActivePicker(null); }}
        />
      )}

      <DeleteFilesConfirmDrawer
        open={deleteOpen}
        onOpenChange={(o) => !submitting && setDeleteOpen(o)}
        service={service}
        fileCount={deletableSelected.length}
        totalBytes={deletableBytes}
        config={config}
        busy={submitting}
        onConfirm={doDelete}
      />
    </div>
  );
}

// ── Episode picker (multi-select, full screen) ────────────────────────────────
function EpisodePicker({ episodes, initial, onCancel, onConfirm }: {
  episodes: SonarrEpisode[];
  initial: SonarrEpisode[];
  onCancel: () => void;
  onConfirm: (eps: SonarrEpisode[]) => void;
}) {
  const [picked, setPicked] = React.useState<Set<number>>(new Set(initial.map((e) => e.id)));
  const [filter, setFilter] = React.useState('');
  const bySeason = React.useMemo(() => {
    const g = new Map<number, SonarrEpisode[]>();
    for (const e of episodes) { const l = g.get(e.seasonNumber) || []; l.push(e); g.set(e.seasonNumber, l); }
    return [...g.entries()].sort(([a], [b]) => a - b);
  }, [episodes]);
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? bySeason.map(([s, eps]) => [s, eps.filter((e) => String(e.episodeNumber).includes(q) || (e.title || 'TBA').toLowerCase().includes(q))] as [number, SonarrEpisode[]]).filter(([, e]) => e.length)
    : bySeason;

  return (
    <div className="animate-content-in">
      <PageHeader title="Select Episode(s)" onBack={onCancel} rightContent={
        <Button size="sm" disabled={picked.size === 0} onClick={() => onConfirm(episodes.filter((e) => picked.has(e.id)))}>
          Select ({picked.size})
        </Button>
      } />
      <div className="border-b border-border py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter episodes by title or number"
            className="w-full rounded-lg bg-muted/40 py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary/40" />
        </div>
      </div>
      <div className="pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {filtered.map(([season, eps]) => (
          <div key={season}>
            <div
              className="sticky z-10 border-b border-border/50 bg-background/95 py-2 backdrop-blur-sm"
              style={{ top: 'calc(var(--header-height, 0px) + 2.75rem)' }}
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {season === 0 ? 'Specials' : `Season ${season}`}
              </span>
            </div>
            {eps.map((ep) => {
              const on = picked.has(ep.id);
              return (
                <button key={ep.id} onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(ep.id)) n.delete(ep.id); else n.add(ep.id); return n; })}
                  className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted/60', on ? 'bg-primary/8' : 'hover:bg-muted/40')}>
                  <span aria-hidden className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="w-8 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">E{String(ep.episodeNumber).padStart(2, '0')}</span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm', (!ep.title || ep.title === 'TBA') && 'italic text-muted-foreground')}>{ep.title || 'TBA'}</p>
                    {ep.airDate && <p className="mt-0.5 text-[11px] text-muted-foreground">{ep.airDate}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Small property pickers (Dialogs) ──────────────────────────────────────────
function SeasonPicker({ open, episodes, onClose, onSelect }: {
  open: boolean; episodes: SonarrEpisode[]; onClose: () => void; onSelect: (s: number) => void;
}) {
  const seasons = React.useMemo(() => [...new Set(episodes.map((e) => e.seasonNumber))].sort((a, b) => b - a), [episodes]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Select Season</DialogTitle>
          <DialogDescription className="sr-only">Reassign the selected files to a season.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50dvh] overflow-y-auto">
          {seasons.map((s) => (
            <button key={s} onClick={() => onSelect(s)} className="w-full border-b border-border/40 px-1 py-3 text-left text-sm active:bg-muted/40">
              {s === 0 ? 'Specials' : `Season ${s}`}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QualityPicker({ open, defs, loading, onClose, onSelect }: {
  open: boolean; defs: { id: number; quality: ArrQualityModel['quality'] }[]; loading: boolean; onClose: () => void; onSelect: (q: ArrQualityModel) => void;
}) {
  const [id, setId] = React.useState('');
  const [proper, setProper] = React.useState(false);
  const [real, setReal] = React.useState(false);
  React.useEffect(() => { if (open) { setId(''); setProper(false); setReal(false); } }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Select Quality</DialogTitle>
          <DialogDescription className="sr-only">Set quality on the selected files.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Select value={id} onValueChange={setId}>
            <SelectTrigger><SelectValue placeholder={loading ? 'Loading…' : 'Quality'} /></SelectTrigger>
            <SelectContent>{defs.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.quality.name}</SelectItem>)}</SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={proper} onCheckedChange={(v) => setProper(v === true)} /> Proper</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={real} onCheckedChange={(v) => setReal(v === true)} /> Real</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!id} onClick={() => {
            const def = defs.find((d) => String(d.id) === id);
            if (def) onSelect({ quality: def.quality, revision: { version: proper ? 2 : 1, real: real ? 1 : 0, isRepack: false } });
          }}>Select Quality</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseGroupPicker({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (rg: string) => void; }) {
  const [val, setVal] = React.useState('');
  React.useEffect(() => { if (open) setVal(''); }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Select Release Group</DialogTitle>
          <DialogDescription className="sr-only">Set the release group on the selected files.</DialogDescription>
        </DialogHeader>
        <Input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Release group" autoFocus />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSelect(val.trim())}>Set Release Group</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LanguagePicker({ open, languages, loading, onClose, onSelect }: {
  open: boolean; languages: ArrLanguage[]; loading: boolean; onClose: () => void; onSelect: (l: ArrLanguage[]) => void;
}) {
  const [picked, setPicked] = React.useState<Set<number>>(new Set());
  const [filter, setFilter] = React.useState('');
  React.useEffect(() => { if (open) { setPicked(new Set()); setFilter(''); } }, [open]);
  const q = filter.trim().toLowerCase();
  const list = q ? languages.filter((l) => l.name.toLowerCase().includes(q)) : languages;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Select Language</DialogTitle>
          <DialogDescription className="sr-only">Set languages on the selected files.</DialogDescription>
        </DialogHeader>
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={loading ? 'Loading…' : 'Filter languages'} />
        <ScrollArea className="max-h-[45dvh] rounded-md border">
          <div className="p-1">
            {list.map((l) => {
              const on = picked.has(l.id);
              return (
                <button key={l.id} onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-muted/50">
                  {l.name}{on && <Check className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={picked.size === 0} onClick={() => onSelect(languages.filter((l) => picked.has(l.id)))}>Select Languages</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IndexerFlagsPicker({ open, options, onClose, onSelect }: {
  open: boolean; options: { label: string; value: number }[]; onClose: () => void; onSelect: (flags: number) => void;
}) {
  const [bits, setBits] = React.useState(0);
  React.useEffect(() => { if (open) setBits(0); }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Set Indexer Flags</DialogTitle>
          <DialogDescription className="sr-only">Set indexer flags on the selected files.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          {options.map((f) => {
            const on = (bits & f.value) !== 0;
            return (
              <label key={f.value} className="flex items-center gap-2 rounded px-1 py-2 text-sm">
                <Checkbox checked={on} onCheckedChange={(v) => setBits((b) => (v === true ? b | f.value : b & ~f.value))} />
                {f.label}
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSelect(bits)}>Set Indexer Flags</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseTypePicker({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (rt: ReleaseType) => void; }) {
  const [val, setVal] = React.useState<ReleaseType>('unknown');
  React.useEffect(() => { if (open) setVal('unknown'); }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Select Release Type</DialogTitle>
          <DialogDescription className="sr-only">Set the release type on the selected files.</DialogDescription>
        </DialogHeader>
        <Select value={val} onValueChange={(v) => setVal(v as ReleaseType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{RELEASE_TYPES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSelect(val)}>Select Release Type</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
