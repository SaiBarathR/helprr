'use client';

import { useState } from 'react';
import { ApiError, jsonFetcher, withInstanceQuery } from '@/lib/query-fetch';
import { useParams, useSearchParams } from 'next/navigation';
import { goBackOr, useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { PageHeader } from '@/components/layout/page-header';
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
import { invalidateMovies } from '@/lib/query-invalidation';
import { useQualityProfiles, useRootFolders } from '@/lib/hooks/use-reference-data';
import { useCan } from '@/components/permission-provider';
import type { RadarrMovie } from '@/types';
import { folderNameError, lastPathSegment, parentPath, pathInRootFolder, sameFolder } from '@/lib/paths';

export default function MovieEditPage() {
  const { id } = useParams();
  const router = useRouter();
  const instance = useSearchParams().get('instance') ?? undefined;
  const queryClient = useQueryClient();
  const movieId = Number(id);
  const detailHref = `/movies/${movieId}${instance ? `?instance=${encodeURIComponent(instance)}` : ''}`;

  const movieQuery = useQuery({
    queryKey: queryKeys.detail('radarr', movieId, instance),
    queryFn: jsonFetcher<RadarrMovie>(`/api/radarr/${movieId}`, instance),
    enabled: Number.isFinite(movieId),
  });
  const movie = movieQuery.data ?? null;
  const loading = movieQuery.isLoading;

  const { data: qualityProfiles = [] } = useQualityProfiles('radarr', instance);
  // The rootfolders route 403s without add/changePath, so skip the fetch (and
  // the path picker) for editors who can't change paths anyway.
  const canChangePath = useCan('movies.changePath');
  const { data: rootFolders = [] } = useRootFolders('radarr', instance, canChangePath);

  // Edit form state
  const [qualityProfileId, setQualityProfileId] = useState<number>(0);
  const [minimumAvailability, setMinimumAvailability] = useState('');
  const [rootFolder, setRootFolder] = useState('');
  const [folderName, setFolderName] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  // Without a move Radarr points the movie at a folder its files are not in.
  const [moveFiles, setMoveFiles] = useState(true);
  const [confirmMove, setConfirmMove] = useState(false);

  // Seed the form once the movie loads (and re-seed if the cached movie
  // changes). Guarded during render.
  const [seededMovie, setSeededMovie] = useState<RadarrMovie | null>(null);
  if (movie && movie !== seededMovie) {
    setSeededMovie(movie);
    setQualityProfileId(movie.qualityProfileId);
    setMinimumAvailability(movie.minimumAvailability);
    setSelectedTags([...movie.tags]);
    setRootFolder(movie.path ? parentPath(movie.path) : '');
    setFolderName(movie.path ? lastPathSegment(movie.path) : '');
  }

  const saveMutation = useMutation({
    mutationFn: async ({ updatedMovie, move }: { updatedMovie: RadarrMovie; move: boolean }) => {
      const url = `/api/radarr/${updatedMovie.id}${move ? '?moveFiles=true' : ''}`;
      const res = await fetch(withInstanceQuery(url, instance), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedMovie),
      });
      // ApiError (not a plain Error) so a 401 carries its status to the global
      // MutationCache handler, which redirects to /login.
      if (!res.ok) throw new ApiError(res.status, 'Failed to update movie');
    },
    onSuccess: (_data, { updatedMovie }) => {
      invalidateMovies(queryClient, { itemId: updatedMovie.id, instanceId: instance });
      toast.success('Movie updated');
      goBackOr(router, detailHref);
    },
    onError: (err) => {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (err instanceof ApiError && err.status === 401) return;
      toast.error('Failed to update movie');
    },
  });
  const saving = saveMutation.isPending;
  // A rename keeps the title in its root folder, so it needs one the instance lists:
  // a title in a sub-folder of one picks a root folder first.
  const rootListed = rootFolders.some((rf) => sameFolder(rf.path, rootFolder));
  // The current name is never refused: it is the one Radarr chose.
  const folderError = movie?.path && folderName !== lastPathSegment(movie.path) ? folderNameError(folderName, rootFolder) : null;
  const movedPath = movie?.path && !folderError ? pathInRootFolder(movie.path, rootFolder, folderName) : null;
  const moving = movedPath !== null && moveFiles;

  function save() {
    if (!movie) return;

    const updatedMovie: RadarrMovie = {
      ...movie,
      qualityProfileId,
      minimumAvailability,
      tags: selectedTags,
    };

    // Update root folder path if changed
    if (movedPath) updatedMovie.path = movedPath;

    saveMutation.mutate({ updatedMovie, move: moving }, { onSettled: () => setConfirmMove(false) });
  }

  function handleSave() {
    if (folderError) return;
    // Moving files is a disk operation: confirm it first, as the bulk editor does.
    if (moving) setConfirmMove(true);
    else save();
  }

  if (loading && !movie) {
    return <><PageHeader title="Edit Movie" backHref={detailHref} /><PageSpinner /></>;
  }

  if (!movie) {
    return (
      <div>
        <PageHeader title="Edit Movie" backHref={detailHref} />
        <div className="text-center py-12 text-muted-foreground">
          Movie not found
        </div>
      </div>
    );
  }

  return (
    <div className="animate-content-in">
      <PageHeader title={`Edit ${movie.title}`} backHref={detailHref} />

      {/* A form, so the keyboard's Go saves and, with the keyboard up, the page
          keeps Save above it while the folder name is typed (followPageKeyboard). */}
      <form
        className="mx-auto max-w-2xl px-4 space-y-6 mt-4 pb-8"
        onSubmit={(event) => {
          event.preventDefault();
          handleSave();
        }}
      >
        {/* Settings Section */}
        <div className="grouped-section">
          <div className="grouped-section-title">Settings</div>
          <div className="grouped-section-content">
            {/* Quality Profile */}
            <div className="grouped-row">
              <Label className="text-sm shrink-0">Quality Profile</Label>
              <Select
                value={String(qualityProfileId)}
                onValueChange={(v) => setQualityProfileId(Number(v))}
              >
                <SelectTrigger className="w-[180px] min-w-0 ml-3">
                  <SelectValue placeholder="Select profile" />
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

            {/* Minimum Availability */}
            <div className="grouped-row">
              <Label className="text-sm shrink-0">Minimum Availability</Label>
              <Select
                value={minimumAvailability}
                onValueChange={setMinimumAvailability}
              >
                <SelectTrigger className="w-[180px] min-w-0 ml-3">
                  <SelectValue placeholder="Select availability" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="announced">Announced</SelectItem>
                  <SelectItem value="inCinemas">In Cinemas</SelectItem>
                  <SelectItem value="released">Released</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Root Folder */}
            {rootFolders.length > 0 && (
              <div className="grouped-row">
                <Label className="text-sm shrink-0">Root Folder</Label>
                <Select value={rootFolder} onValueChange={setRootFolder}>
                  <SelectTrigger className="w-[180px] min-w-0 ml-3 sm:w-auto sm:min-w-[180px] sm:max-w-md" title={rootFolder || undefined}>
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
                <Label htmlFor="move-files" className="text-sm shrink-0">Move Files</Label>
                <Switch id="move-files" checked={moveFiles} onCheckedChange={setMoveFiles} />
              </div>
            )}
          </div>
          {rootFolders.length > 0 && !rootListed && (
            <p className="px-4 pt-2 text-xs text-muted-foreground">
              The movie isn’t directly inside a root folder. Pick one to rename its folder.
            </p>
          )}
          {folderError && (
            <p id={FOLDER_NAME_ERROR_ID} className="px-4 pt-2 text-xs text-destructive">{folderError}</p>
          )}
          {movedPath && (
            <p className="px-4 pt-2 text-xs text-muted-foreground">
              {moveFiles
                ? 'Radarr moves the movie’s files into this folder.'
                : 'Only the saved path changes; files stay where they are until you move them.'}
              <span className="mt-1 block break-words">New path: <WrappingPath path={movedPath} /></span>
            </p>
          )}
        </div>

        {/* Tags Section */}
        <div className="grouped-section">
          <div className="grouped-section-title">Tags</div>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <TagSelector
                service="radarr"
                instanceId={instance}
                value={selectedTags}
                onChange={setSelectedTags}
              />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2">
          <Button
            type="submit"
            className="flex-1"
            disabled={saving || folderError !== null}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => goBackOr(router, detailHref)}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmMove}
        onOpenChange={(open) => { if (!open && !saving) setConfirmMove(false); }}
        title={`Move files for ${movie.title}?`}
        description={`Radarr will move the files of ${movie.title} into ${movedPath ?? ''}. Files move on disk, which can take a while.`}
        confirmLabel="Move files"
        destructive
        busy={saving}
        onConfirm={save}
      />
    </div>
  );
}
