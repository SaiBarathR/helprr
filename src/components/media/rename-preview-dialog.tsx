'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, arrMutationFetch, jsonFetcher } from '@/lib/query-fetch';
import { pollCommand } from '@/lib/arr-command';
import { invalidateMovies, invalidateMusic, invalidateSeries } from '@/lib/query-invalidation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SonarrRenamePreview, RadarrRenamePreview, LidarrRenamePreview } from '@/types';

type RenameService = 'sonarr' | 'radarr' | 'lidarr';

type RenameRow = {
  fileId: number;
  existingPath: string;
  newPath: string;
  meta?: string;
};

interface RenamePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: RenameService;
  mediaId: number;
  mediaTitle: string;
  instanceId?: string;
}

const INVALIDATE_BY_SERVICE = {
  sonarr: invalidateSeries,
  radarr: invalidateMovies,
  lidarr: invalidateMusic,
} as const;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toRows(
  service: RenameService,
  data: SonarrRenamePreview[] | RadarrRenamePreview[] | LidarrRenamePreview[]
): RenameRow[] {
  if (service === 'sonarr') {
    return (data as SonarrRenamePreview[]).map((d) => ({
      fileId: d.episodeFileId,
      existingPath: d.existingPath,
      newPath: d.newPath,
      meta: `S${pad(d.seasonNumber)}${(d.episodeNumbers ?? [])
        .map((e) => `E${pad(e)}`)
        .join('')}`,
    }));
  }
  if (service === 'lidarr') {
    return (data as LidarrRenamePreview[]).map((d) => ({
      fileId: d.trackFileId,
      existingPath: d.existingPath,
      newPath: d.newPath,
      meta: (d.trackNumbers ?? []).map((t) => `#${t}`).join(' '),
    }));
  }
  return (data as RadarrRenamePreview[]).map((d) => ({
    fileId: d.movieFileId,
    existingPath: d.existingPath,
    newPath: d.newPath,
  }));
}

export function RenamePreviewDialog({
  open,
  onOpenChange,
  service,
  mediaId,
  mediaTitle,
  instanceId,
}: RenamePreviewDialogProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();

  const queryParam = service === 'sonarr' ? 'seriesId' : service === 'lidarr' ? 'artistId' : 'movieId';
  const {
    data: rows = [],
    isFetching: loading,
    isError,
    isSuccess,
  } = useQuery({
    queryKey: [service, 'rename', instanceId ?? 'default', mediaId],
    queryFn: jsonFetcher<SonarrRenamePreview[] | RadarrRenamePreview[] | LidarrRenamePreview[]>(
      `/api/${service}/rename?${queryParam}=${mediaId}`,
      instanceId,
    ),
    enabled: open,
    // Rename candidates change the moment a refresh/rescan/rename lands on the
    // *arr side, so a reopened dialog must refetch instead of replaying a cached
    // "nothing to rename". `loading` is isFetching (not isLoading) for the same
    // reason: never flash the previous open's stale rows while refetching.
    staleTime: 0,
    select: (data) => toRows(service, data),
  });

  // Default every previewed file to selected once the preview resolves — but only
  // once per open, and only from FRESH data (isSuccess alone is instantly true
  // when cached rows exist, which would seed the selection from stale file ids).
  // Keying this on the data timestamp would re-run on a background refetch
  // (e.g. reconnect) and silently re-select files the user just deselected.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (isSuccess && !loading && !seededRef.current) {
      seededRef.current = true;
      setSelected(new Set(rows.map((r) => r.fileId)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isSuccess, loading]);

  useEffect(() => {
    if (isError) toast.error('Failed to load rename preview');
  }, [isError]);

  function toggleRow(fileId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.fileId))
    );
  }

  const applyMutation = useMutation({
    mutationFn: async (fileIds: number[]) => {
      const body =
        service === 'sonarr'
          ? { name: 'RenameFiles', seriesId: mediaId, files: fileIds }
          : service === 'lidarr'
            ? { name: 'RenameFiles', artistId: mediaId, files: fileIds }
            : { name: 'RenameFiles', movieId: mediaId, files: fileIds };
      const res = await arrMutationFetch(instanceId, `/api/${service}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await res.text());
      return (await res.json()) as { id?: number };
    },
    onSuccess: (command, fileIds) => {
      toast.success(`Renaming ${fileIds.length} file${fileIds.length === 1 ? '' : 's'}`);
      onOpenChange(false);
      // RenameFiles is async on the *arr side: wait for it to finish, then refetch
      // everything that still shows the old paths. Polling the command status route
      // also drops the server-side library cache on completion.
      const invalidate = () =>
        INVALIDATE_BY_SERVICE[service](queryClient, { itemId: mediaId, instanceId });
      if (command.id) void pollCommand(service, command.id, instanceId).then(invalidate);
      else invalidate();
    },
    onError: () => toast.error('Failed to rename files'),
  });
  const submitting = applyMutation.isPending;

  function handleApply() {
    if (selected.size === 0) return;
    applyMutation.mutate(Array.from(selected));
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && selected.size < rows.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preview Rename</DialogTitle>
          <DialogDescription>{mediaTitle}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Everything is already named correctly.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-border pb-2">
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={toggleAll}
                aria-label="Select all"
              />
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {selected.size} of {rows.length} selected
              </span>
            </div>

            <ScrollArea className="max-h-[50vh] -mx-2">
              <ul className="px-2 space-y-2">
                {rows.map((r) => {
                  const checked = selected.has(r.fileId);
                  return (
                    <li
                      key={r.fileId}
                      className="flex items-start gap-3 rounded-md p-2 hover:bg-muted/40 cursor-pointer"
                      onClick={() => toggleRow(r.fileId)}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleRow(r.fileId)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Select file"
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0 space-y-0.5">
                        {r.meta && (
                          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                            {r.meta}
                          </p>
                        )}
                        <p className="text-xs font-mono break-all text-muted-foreground line-through">
                          {r.existingPath}
                        </p>
                        <p className="text-xs font-mono break-all text-foreground">
                          {r.newPath}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          </>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {rows.length === 0 ? 'Close' : 'Cancel'}
          </Button>
          {rows.length > 0 && (
            <Button
              onClick={handleApply}
              disabled={selected.size === 0 || submitting}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply Rename ({selected.size})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
