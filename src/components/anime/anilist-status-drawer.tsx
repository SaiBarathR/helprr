'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/components/ui/drawer';
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
import { Loader2, Trash2 } from 'lucide-react';
import type { AniListMediaListEntryBase, AniListMediaListStatus } from '@/lib/anilist-mutations';

const STATUS_LABELS_ANIME: Record<AniListMediaListStatus, string> = {
  CURRENT: 'Watching',
  PLANNING: 'Planning',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
  REPEATING: 'Repeating',
};

const STATUS_LABELS_MANGA: Record<AniListMediaListStatus, string> = {
  CURRENT: 'Reading',
  PLANNING: 'Planning',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
  REPEATING: 'Re-reading',
};

interface FormState {
  status: AniListMediaListStatus;
  score: string;
  progress: string;
  progressVolumes: string;
  notes: string;
}

interface AnilistStatusDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mediaId: number;
  mediaTitle: string;
  mediaType: 'ANIME' | 'MANGA';
  totalEpisodes?: number | null;
  totalChapters?: number | null;
  totalVolumes?: number | null;
  entry: AniListMediaListEntryBase | null;
  scoreFormat?: string | null;
  onSaved: (entry: AniListMediaListEntryBase) => void;
  onDeleted: () => void;
}

function formatProgressTotal(total: number | null | undefined): string {
  return total != null ? `/ ${total}` : '';
}

function getScoreConfig(scoreFormat: string | null | undefined) {
  switch (scoreFormat) {
    case 'POINT_100':
      return { min: 0, max: 100, step: 1, label: 'Score (0-100)' };
    case 'POINT_10_DECIMAL':
      return { min: 0, max: 10, step: 0.1, label: 'Score (0-10)' };
    case 'POINT_5':
      return { min: 0, max: 5, step: 1, label: 'Score (0-5)' };
    case 'POINT_3':
      return { min: 0, max: 3, step: 1, label: 'Score (0-3)' };
    case 'POINT_10':
    default:
      return { min: 0, max: 10, step: 1, label: 'Score (0-10)' };
  }
}

export function AnilistStatusDrawer({
  open,
  onOpenChange,
  mediaId,
  mediaTitle,
  mediaType,
  totalEpisodes,
  totalChapters,
  totalVolumes,
  entry,
  scoreFormat,
  onSaved,
  onDeleted,
}: AnilistStatusDrawerProps) {
  const isManga = mediaType === 'MANGA';
  const labels = isManga ? STATUS_LABELS_MANGA : STATUS_LABELS_ANIME;
  const scoreConfig = getScoreConfig(scoreFormat);

  const [form, setForm] = useState<FormState>(() => ({
    status: entry?.status || 'PLANNING',
    score: entry && entry.score > 0 ? String(entry.score) : '',
    progress: entry ? String(entry.progress) : '0',
    progressVolumes: entry?.progressVolumes != null ? String(entry.progressVolumes) : '',
    notes: entry?.notes ?? '',
  }));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      status: entry?.status || 'PLANNING',
      score: entry && entry.score > 0 ? String(entry.score) : '',
      progress: entry ? String(entry.progress) : '0',
      progressVolumes: entry?.progressVolumes != null ? String(entry.progressVolumes) : '',
      notes: entry?.notes ?? '',
    });
  }, [open, entry]);

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        mediaId,
        status: form.status,
      };
      const score = Number(form.score);
      if (form.score.trim() !== '') {
        if (!Number.isFinite(score) || score < scoreConfig.min || score > scoreConfig.max) {
          toast.error(`Score must be between ${scoreConfig.min} and ${scoreConfig.max}`);
          return;
        }
        body.score = score;
      }
      const progress = Number(form.progress);
      if (form.progress.trim() !== '' && Number.isFinite(progress)) body.progress = progress;
      if (isManga && form.progressVolumes.trim() !== '') {
        const pv = Number(form.progressVolumes);
        if (Number.isFinite(pv)) body.progressVolumes = pv;
      }
      if (form.notes.trim()) body.notes = form.notes.trim();

      const res = await fetch('/api/anilist/list-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok || !data.entry) {
        toast.error(data.error || 'Failed to save');
        return;
      }
      toast.success('Saved to AniList');
      onSaved(data.entry);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!entry) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/anilist/list-entry?id=${entry.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.deleted) {
        toast.error(data.error || 'Failed to remove');
        return;
      }
      toast.success('Removed from AniList');
      onDeleted();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Network error');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[95vh]">
        <DrawerHeader>
          <DrawerTitle>{entry ? 'Edit AniList Entry' : 'Add to AniList'}</DrawerTitle>
          <DrawerDescription className="line-clamp-1">{mediaTitle}</DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-2 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm((prev) => ({ ...prev, status: v as AniListMediaListStatus }))}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(labels) as AniListMediaListStatus[]).map((status) => (
                  <SelectItem key={status} value={status}>
                    {labels[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{scoreConfig.label}</Label>
            <Input
              type="number"
              min={String(scoreConfig.min)}
              max={String(scoreConfig.max)}
              step={String(scoreConfig.step)}
              placeholder="—"
              value={form.score}
              onChange={(e) => setForm((prev) => ({ ...prev, score: e.target.value }))}
              className="h-10"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {isManga ? 'Chapter Progress' : 'Episode Progress'} {formatProgressTotal(isManga ? totalChapters : totalEpisodes)}
            </Label>
            <Input
              type="number"
              min="0"
              placeholder="0"
              value={form.progress}
              onChange={(e) => setForm((prev) => ({ ...prev, progress: e.target.value }))}
              className="h-10"
            />
          </div>

          {isManga && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Volume Progress {formatProgressTotal(totalVolumes)}
              </Label>
              <Input
                type="number"
                min="0"
                placeholder="0"
                value={form.progressVolumes}
                onChange={(e) => setForm((prev) => ({ ...prev, progressVolumes: e.target.value }))}
                className="h-10"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <textarea
              rows={3}
              placeholder="Optional"
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
            />
          </div>
        </div>
        <DrawerFooter>
          <div className="flex gap-2 pt-1">
            {entry && (
              <Button
                variant="outline"
                className="text-red-400 hover:text-red-500"
                onClick={handleDelete}
                disabled={deleting || saving}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            )}
            <Button className="flex-1" onClick={handleSave} disabled={saving || deleting}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : entry ? (
                'Save Changes'
              ) : (
                'Add to AniList'
              )}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
