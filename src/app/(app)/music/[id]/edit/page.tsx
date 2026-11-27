'use client';

import { useState } from 'react';
import { ApiError, jsonFetcher, withInstanceQuery } from '@/lib/query-fetch';
import { useParams, useSearchParams } from 'next/navigation';
import { goBackOr, useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { PageHeader } from '@/components/layout/page-header';
import { NotFoundState } from '@/components/ui/not-found-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageSpinner } from '@/components/ui/page-spinner';
import { TagSelector } from '@/components/media/tag-selector';
import { FOLDER_NAME_ERROR_ID, FolderNameRow, WrappingPath } from '@/components/media/folder-name-row';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { invalidateMusic } from '@/lib/query-invalidation';
import {
  useQualityProfiles,
  useMetadataProfiles,
  useRootFolders,
} from '@/lib/hooks/use-reference-data';
import { useCan } from '@/components/permission-provider';
import type { LidarrArtist } from '@/types';
import { folderNameError, lastPathSegment, parentPath, pathInRootFolder, sameFolder } from '@/lib/paths';

export default function ArtistEditPage() {
  const { id } = useParams();
  const router = useRouter();
  const instance = useSearchParams().get('instance') ?? undefined;
  const queryClient = useQueryClient();
  const artistId = Number(id);
  const detailHref = `/music/${artistId}${instance ? `?instance=${encodeURIComponent(instance)}` : ''}`;

  const artistQuery = useQuery({
    queryKey: queryKeys.detail('lidarr', artistId, instance),
    queryFn: jsonFetcher<LidarrArtist>(`/api/lidarr/${artistId}`, instance),
    enabled: Number.isFinite(artistId),
  });
  const artist = artistQuery.data ?? null;
  const loading = artistQuery.isLoading;

  const { data: qualityProfiles = [] } = useQualityProfiles('lidarr', instance);
  const { data: metadataProfiles = [] } = useMetadataProfiles(instance);
  // The rootfolders route 403s without add/changePath, so skip the fetch (and
  // the path picker) for editors who can't change paths anyway.
  const canChangePath = useCan('music.changePath');
  const { data: rootFolders = [] } = useRootFolders('lidarr', instance, canChangePath);

  const [qualityProfileId, setQualityProfileId] = useState<number>(0);
  const [metadataProfileId, setMetadataProfileId] = useState<number>(0);
  const [monitorNewItems, setMonitorNewItems] = useState('all');
  const [rootFolder, setRootFolder] = useState('');
  const [folderName, setFolderName] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  // Without a move Lidarr points the artist at a folder its files are not in.
  const [moveFiles, setMoveFiles] = useState(true);
  const [confirmMove, setConfirmMove] = useState(false);

  // Seed the form once the artist loads (and re-seed if the cached artist
  // changes). Guarded during render.
  const [seededArtist, setSeededArtist] = useState<LidarrArtist | null>(null);
  if (artist && artist !== seededArtist) {
    setSeededArtist(artist);
    setQualityProfileId(artist.qualityProfileId);
    setMetadataProfileId(artist.metadataProfileId);
    setMonitorNewItems(artist.monitorNewItems || 'all');
    setSelectedTags([...artist.tags]);
    setRootFolder(artist.path ? parentPath(artist.path) : '');
    setFolderName(artist.path ? lastPathSegment(artist.path) : '');
  }

  const saveMutation = useMutation({
    mutationFn: async ({ updated, move }: { updated: LidarrArtist; move: boolean }) => {
      const url = `/api/lidarr/${updated.id}${move ? '?moveFiles=true' : ''}`;
      const res = await fetch(withInstanceQuery(url, instance), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      // ApiError (not a plain Error) so a 401 carries its status to the global
      // MutationCache handler, which redirects to /login.
      if (!res.ok) throw new ApiError(res.status, 'Failed to update artist');
    },
    onSuccess: (_data, { updated }) => {
      invalidateMusic(queryClient, { itemId: updated.id, instanceId: instance });
      toast.success('Artist updated');
      goBackOr(router, detailHref);
    },
    onError: (err) => {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (err instanceof ApiError && err.status === 401) return;
      toast.error('Failed to update artist');
    },
  });
  const saving = saveMutation.isPending;
  // A rename keeps the title in its root folder, so it needs one the instance lists:
  // a title in a sub-folder of one picks a root folder first.
  const rootListed = rootFolders.some((rf) => sameFolder(rf.path, rootFolder));
  // The current name is never refused: it is the one Lidarr chose.
  const folderError = artist?.path && folderName !== lastPathSegment(artist.path) ? folderNameError(folderName, rootFolder) : null;
  const movedPath = artist?.path && !folderError ? pathInRootFolder(artist.path, rootFolder, folderName) : null;
  const moving = movedPath !== null && moveFiles;

  function save() {
    if (!artist) return;

    const updated: LidarrArtist = {
      ...artist,
      qualityProfileId,
      metadataProfileId,
      monitorNewItems,
      tags: selectedTags,
    };

    if (movedPath) updated.path = movedPath;

    saveMutation.mutate({ updated, move: moving }, { onSettled: () => setConfirmMove(false) });
  }

  function handleSave() {
    if (folderError) return;
    // Moving files is a disk operation: confirm it first, as the bulk editor does.
    if (moving) setConfirmMove(true);
    else save();
  }

  if (loading && !artist) {
    return <><PageHeader title="Edit Artist" backHref={detailHref} /><PageSpinner /></>;
  }

  if (!artist) {
    return (
      <div>
        <PageHeader title="Edit Artist" backHref={detailHref} />
        <NotFoundState message="Artist not found" />
      </div>
    );
  }

  return (
    <div className="animate-content-in">
      <PageHeader title={`Edit ${artist.artistName}`} backHref={detailHref} />

      {/* A form, so the keyboard's Go saves and, with the keyboard up, the page
          keeps Save above it while the folder name is typed (followPageKeyboard). */}
      <form
        className="mx-auto max-w-2xl px-4 space-y-6 mt-4 pb-8"
        onSubmit={(event) => {
          event.preventDefault();
          handleSave();
        }}
      >
        <div className="grouped-section">
          <div className="grouped-section-title">Settings</div>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <Label className="text-sm shrink-0">Quality Profile</Label>
              <Select value={String(qualityProfileId)} onValueChange={(v) => setQualityProfileId(Number(v))}>
                <SelectTrigger className="w-[180px] min-w-0 ml-3"><SelectValue placeholder="Select profile" /></SelectTrigger>
                <SelectContent>
                  {qualityProfiles.map((qp) => (
                    <SelectItem key={qp.id} value={String(qp.id)}>{qp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grouped-row">
              <Label className="text-sm shrink-0">Metadata Profile</Label>
              <Select value={String(metadataProfileId)} onValueChange={(v) => setMetadataProfileId(Number(v))}>
                <SelectTrigger className="w-[180px] min-w-0 ml-3"><SelectValue placeholder="Select profile" /></SelectTrigger>
                <SelectContent>
                  {metadataProfiles.map((mp) => (
                    <SelectItem key={mp.id} value={String(mp.id)}>{mp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grouped-row">
              <Label className="text-sm shrink-0">Monitor New Albums</Label>
              <Select value={monitorNewItems} onValueChange={setMonitorNewItems}>
                <SelectTrigger className="w-[180px] min-w-0 ml-3"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All new albums</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {rootFolders.length > 0 && (
              <div className="grouped-row">
                <Label className="text-sm shrink-0">Root Folder</Label>
                <Select value={rootFolder} onValueChange={setRootFolder}>
                  <SelectTrigger className="w-[180px] min-w-0 ml-3 sm:w-auto sm:min-w-[180px] sm:max-w-md" title={rootFolder || undefined}><SelectValue placeholder="Select folder">{rootFolder ? <span className="truncate">{rootFolder}</span> : null}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {rootFolders.map((rf) => (
                      <SelectItem key={rf.id} value={rf.path}>{rf.path}</SelectItem>
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
                <Label htmlFor="move-files" className="text-sm shrink-0">Move Files</Label>
                <Switch id="move-files" checked={moveFiles} onCheckedChange={setMoveFiles} />
              </div>
            )}
          </div>
          {rootFolders.length > 0 && !rootListed && (
            <p className="px-4 pt-2 text-xs text-muted-foreground">
              The artist isn’t directly inside a root folder. Pick one to rename its folder.
            </p>
          )}
          {folderError && (
            <p id={FOLDER_NAME_ERROR_ID} className="px-4 pt-2 text-xs text-destructive">{folderError}</p>
          )}
          {movedPath && (
            <p className="px-4 pt-2 text-xs text-muted-foreground">
              {moveFiles
                ? 'Lidarr moves the artist’s files into this folder.'
                : 'Only the saved path changes; files stay where they are until you move them.'}
              <span className="mt-1 block break-words">New path: <WrappingPath path={movedPath} /></span>
            </p>
          )}
        </div>

        <div className="grouped-section">
          <div className="grouped-section-title">Tags</div>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <TagSelector
                service="lidarr"
                instanceId={instance}
                value={selectedTags}
                onChange={setSelectedTags}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" className="flex-1" disabled={saving || folderError !== null}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={() => goBackOr(router, detailHref)} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmMove}
        onOpenChange={(open) => { if (!open && !saving) setConfirmMove(false); }}
        title={`Move files for ${artist.artistName}?`}
        description={`Lidarr will move the files of ${artist.artistName} into ${movedPath ?? ''}. Files move on disk, which can take a while.`}
        confirmLabel="Move files"
        destructive
        busy={saving}
        onConfirm={save}
      />
    </div>
  );
}
