'use client';

import { useEffect, useRef, useState } from 'react';
import { arrMutationFetch } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';
import { useParams, useSearchParams } from 'next/navigation';
import { goBackOr, useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { PageHeader } from '@/components/layout/page-header';
import { NotFoundState } from '@/components/ui/not-found-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageSpinner } from '@/components/ui/page-spinner';
import { TagSelector } from '@/components/media/tag-selector';
import { FOLDER_NAME_ERROR_ID, FolderNameRow, WrappingPath } from '@/components/media/folder-name-row';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { invalidateSeries } from '@/lib/query-invalidation';
import { useQualityProfiles, useRootFolders } from '@/lib/hooks/use-reference-data';
import { useCan } from '@/components/permission-provider';
import type { SonarrSeries } from '@/types';
import { folderNameError, lastPathSegment, parentPath, pathInRootFolder, sameFolder } from '@/lib/paths';

export default function SeriesEditPage() {
  const { id } = useParams();
  const router = useRouter();
  const instance = useSearchParams().get('instance') ?? undefined;
  const queryClient = useQueryClient();
  const detailHref = `/series/${id}${instance ? `?instance=${encodeURIComponent(instance)}` : ''}`;

  // Shares queryKeys.detail with the series detail page (gcTime → no refetch when
  // arriving from there). null on !ok preserves the original "not found" path.
  const seriesQuery = useQuery({
    queryKey: queryKeys.detail('sonarr', Number(id), instance),
    queryFn: async ({ signal }): Promise<SonarrSeries | null> => {
      const r = await arrMutationFetch(instance, `/api/sonarr/${id}`, { signal });
      return r.ok ? ((await r.json()) as SonarrSeries) : null;
    },
    enabled: Number.isFinite(Number(id)),
  });
  const series = seriesQuery.data ?? null;
  const loading = seriesQuery.isLoading;
  const { data: qualityProfiles = [] } = useQualityProfiles('sonarr', instance);
  // The rootfolders route 403s without add/changePath, so skip the fetch (and
  // the path picker) for editors who can't change paths anyway.
  const canChangePath = useCan('series.changePath');
  const { data: rootFolders = [] } = useRootFolders('sonarr', instance, canChangePath);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [qualityProfileId, setQualityProfileId] = useState<number>(0);
  const [seriesType, setSeriesType] = useState('');
  const [seasonFolder, setSeasonFolder] = useState(true);
  const [monitorNewItems, setMonitorNewItems] = useState<'all' | 'none'>('all');
  const [rootFolder, setRootFolder] = useState('');
  const [rootFolderTouched, setRootFolderTouched] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  // Without a move Sonarr points the series at a folder its files are not in.
  const [moveFiles, setMoveFiles] = useState(true);
  const [confirmMove, setConfirmMove] = useState(false);

  useEffect(() => {
    if (seriesQuery.isError) toast.error('Failed to load series data');
  }, [seriesQuery.isError]);

  // Seed the form once per series — guard with a ref so a background refetch
  // (which yields a fresh `series` object reference) can't reset unsaved edits.
  const seededSeriesIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!series || seededSeriesIdRef.current === series.id) return;
    seededSeriesIdRef.current = series.id;
    setQualityProfileId(series.qualityProfileId);
    setSeriesType(series.seriesType);
    setSeasonFolder(series.seasonFolder);
    setMonitorNewItems(series.monitorNewItems ?? 'all');
    setSelectedTags([...series.tags]);
    setRootFolder(series.path ? parentPath(series.path) : '');
    setFolderName(series.path ? lastPathSegment(series.path) : '');
  }, [series]);

  // A rename keeps the title in its root folder, so it needs one the instance lists:
  // a title in a sub-folder of one picks a root folder first.
  const rootListed = rootFolders.some((rf) => sameFolder(rf.path, rootFolder));
  // The current name is never refused: it is the one Sonarr chose.
  const folderChanged = series?.path ? folderName !== lastPathSegment(series.path) : false;
  const folderError = folderChanged ? folderNameError(folderName, rootFolder) : null;
  const movedPath = (rootFolderTouched || folderChanged) && series?.path && !folderError
    ? pathInRootFolder(series.path, rootFolder, folderName)
    : null;
  const moving = movedPath !== null && moveFiles;

  function handleSave() {
    if (folderError) return;
    // Moving files is a disk operation: confirm it first, as the bulk editor does.
    if (moving) setConfirmMove(true);
    else void save();
  }

  async function save() {
    if (!series) return;
    setSaving(true);
    try {
      const updatedSeries: SonarrSeries = {
        ...series,
        qualityProfileId,
        seriesType,
        seasonFolder,
        monitorNewItems,
        tags: selectedTags,
      };

      if (movedPath) updatedSeries.path = movedPath;

      const url = `/api/sonarr/${series.id}${moving ? '?moveFiles=true' : ''}`;

      const res = await arrMutationFetch(instance, url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSeries),
      });
      if (res.ok) {
        // Refresh the list + this series' detail/episodes so the page we return to
        // shows the saved changes (a path move can shift files).
        invalidateSeries(queryClient, { itemId: series.id, instanceId: instance });
        toast.success('Series updated');
        goBackOr(router, detailHref);
      } else {
        toast.error('Failed to update series');
      }
    } catch (e) {
      handleAuthError(e);
      toast.error('Failed to update series');
    } finally {
      setSaving(false);
      setConfirmMove(false);
    }
  }

  if (loading && !series) {
    return <><PageHeader title="Edit Series" backHref={detailHref} /><PageSpinner /></>;
  }

  if (!series) {
    return (
      <div>
        <PageHeader title="Edit Series" backHref={detailHref} />
        <NotFoundState message="Series not found" />
      </div>
    );
  }

  return (
    <div className="animate-content-in">
      <PageHeader title={`Edit ${series.title}`} backHref={detailHref} />

      <div className="mx-auto max-w-2xl px-4 pt-4 pb-8 space-y-6">
        {/* Quality Profile */}
        <div className="grouped-section">
          <p className="grouped-section-title">Quality Profile</p>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <Label htmlFor="quality-profile" className="text-sm shrink-0">
                Profile
              </Label>
              <Select
                value={String(qualityProfileId)}
                onValueChange={(v) => setQualityProfileId(Number(v))}
              >
                <SelectTrigger id="quality-profile" className="w-[180px] min-w-0 ml-3 border-0 bg-transparent text-right">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {qualityProfiles.map((qp) => (
                    <SelectItem key={qp.id} value={String(qp.id)}>
                      {qp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Series Type */}
        <div className="grouped-section">
          <p className="grouped-section-title">Series Type</p>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <Label htmlFor="series-type" className="text-sm shrink-0">
                Type
              </Label>
              <Select value={seriesType} onValueChange={setSeriesType}>
                <SelectTrigger id="series-type" className="w-[180px] min-w-0 ml-3 border-0 bg-transparent text-right">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="anime">Anime</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Monitoring */}
        <div className="grouped-section">
          <p className="grouped-section-title">Monitoring</p>
          <div className="grouped-section-content">
            <div className="grouped-row gap-3">
              <Label htmlFor="monitor-new-items" className="text-sm shrink-0">
                Monitor New Seasons
              </Label>
              <Select value={monitorNewItems} onValueChange={(v) => setMonitorNewItems(v as 'all' | 'none')}>
                <SelectTrigger id="monitor-new-items" className="w-[180px] min-w-0 ml-3 border-0 bg-transparent text-right">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All new seasons</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Folder */}
        <div className="grouped-section">
          <p className="grouped-section-title">Folder</p>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <Label htmlFor="season-folder" className="text-sm shrink-0">
                Use Season Folder
              </Label>
              <Switch
                id="season-folder"
                checked={seasonFolder}
                onCheckedChange={setSeasonFolder}
              />
            </div>
            {rootFolders.length > 0 && (
              <div className="grouped-row">
                <Label htmlFor="root-folder" className="text-sm shrink-0">
                  Root Folder
                </Label>
                <Select
                  value={rootFolder}
                  onValueChange={(v) => {
                    setRootFolder(v);
                    setRootFolderTouched(true);
                  }}
                >
                  <SelectTrigger id="root-folder" className="w-[180px] min-w-0 ml-3 sm:w-auto sm:min-w-[180px] sm:max-w-md border-0 bg-transparent text-right" title={rootFolder || undefined}>
                    <SelectValue placeholder="Select folder">{rootFolder ? <span className="truncate">{rootFolder}</span> : null}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {rootFolders.map((rf) => (
                      <SelectItem key={rf.id} value={rf.path}>
                        {rf.path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {rootFolders.length > 0 && (
              <FolderNameRow value={folderName} onChange={setFolderName} error={folderError} disabled={!rootListed} />
            )}
            {movedPath && (
              <div className="grouped-row">
                <Label htmlFor="move-files" className="text-sm shrink-0">
                  Move Files
                </Label>
                <Switch id="move-files" checked={moveFiles} onCheckedChange={setMoveFiles} />
              </div>
            )}
          </div>
          {rootFolders.length > 0 && !rootListed && (
            <p className="px-4 pt-2 text-xs text-muted-foreground">
              The series isn’t directly inside a root folder. Pick one to rename its folder.
            </p>
          )}
          {folderError && (
            <p id={FOLDER_NAME_ERROR_ID} className="px-4 pt-2 text-xs text-destructive">{folderError}</p>
          )}
          {movedPath && (
            <p className="px-4 pt-2 text-xs text-muted-foreground">
              {moveFiles
                ? 'Sonarr moves the series’ files into this folder.'
                : 'Only the saved path changes; files stay where they are until you move them.'}
              <span className="mt-1 block break-words">New path: <WrappingPath path={movedPath} /></span>
            </p>
          )}
        </div>

        {/* Tags */}
        <div className="grouped-section">
          <p className="grouped-section-title">Tags</p>
          <div className="grouped-section-content">
            <div className="px-4 py-3">
              <TagSelector
                service="sonarr"
                instanceId={instance}
                value={selectedTags}
                onChange={setSelectedTags}
              />
            </div>
          </div>
        </div>

        {/* Actions: Save first, as on the Movies and Music Edit pages. */}
        <div className="flex gap-3 pt-2">
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={saving || folderError !== null}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => goBackOr(router, detailHref)}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmMove}
        onOpenChange={(open) => { if (!open && !saving) setConfirmMove(false); }}
        title={`Move files for ${series.title}?`}
        description={`Sonarr will move the files of ${series.title} into ${movedPath ?? ''}. Files move on disk, which can take a while.`}
        confirmLabel="Move files"
        destructive
        busy={saving}
        onConfirm={save}
      />
    </div>
  );
}
