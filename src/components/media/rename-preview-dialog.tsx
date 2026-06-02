'use client';

import { useEffect, useState } from 'react';
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
}

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
}: RenamePreviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows] = useState<RenameRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setRows([]);
    setSelected(new Set());

    const queryKey = service === 'sonarr' ? 'seriesId' : service === 'lidarr' ? 'artistId' : 'movieId';
    const url = `/api/${service}/rename?${queryKey}=${mediaId}`;

    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<SonarrRenamePreview[] | RadarrRenamePreview[] | LidarrRenamePreview[]>;
      })
      .then((data) => {
        if (cancelled) return;
        const next = toRows(service, data);
        setRows(next);
        setSelected(new Set(next.map((r) => r.fileId)));
      })
      .catch(() => {
        if (cancelled) return;
        toast.error('Failed to load rename preview');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, service, mediaId]);

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

  async function handleApply() {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      const body =
        service === 'sonarr'
          ? { name: 'RenameFiles', seriesId: mediaId, files: Array.from(selected) }
          : service === 'lidarr'
            ? { name: 'RenameFiles', artistId: mediaId, files: Array.from(selected) }
            : { name: 'RenameFiles', movieId: mediaId, files: Array.from(selected) };
      const res = await fetch(`/api/${service}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(
        `Renaming ${selected.size} file${selected.size === 1 ? '' : 's'}`
      );
      onOpenChange(false);
    } catch {
      toast.error('Failed to rename files');
    } finally {
      setSubmitting(false);
    }
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
