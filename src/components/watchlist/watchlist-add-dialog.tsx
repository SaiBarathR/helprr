'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { normalizeTagName } from '@/lib/watchlist-helpers';

export interface WatchlistDraft {
  source: 'TMDB' | 'TVDB' | 'ANILIST' | 'SONARR' | 'RADARR';
  externalId: string;
  mediaType: 'movie' | 'series' | 'anime';
  title: string;
  year?: number | null;
  posterUrl?: string | null;
  overview?: string | null;
  rating?: number | null;
  /**
   * ISO date string for the media's release/air date. Used as the default
   * value when the user toggles "Remind me on release".
   */
  releaseDate?: string | null;
}

// <input type="datetime-local"> wants `YYYY-MM-DDTHH:mm` in local time.
function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultReminderLocal(releaseDate: string | null | undefined): string {
  // Only a calendar date — schedule the reminder for 9am local on that day so
  // it doesn't land at midnight UTC (likely the night before, locally).
  if (!releaseDate) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return toDatetimeLocalValue(tomorrow.toISOString());
  }
  const d = new Date(releaseDate);
  if (!Number.isFinite(d.getTime())) return '';
  // If only a date (YYYY-MM-DD), it parses to UTC midnight. Set local 9am instead.
  if (/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
    const [y, m, day] = releaseDate.split('-').map(Number);
    const local = new Date(y, m - 1, day, 9, 0, 0, 0);
    return toDatetimeLocalValue(local.toISOString());
  }
  return toDatetimeLocalValue(releaseDate);
}

interface KnownTag {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: WatchlistDraft | null;
  initialTags?: string[];
  onSaved?: () => void;
}

export function WatchlistAddDialog({ open, onOpenChange, draft, initialTags, onSaved }: Props) {
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [knownTags, setKnownTags] = useState<KnownTag[]>([]);
  const [saving, setSaving] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderValue, setReminderValue] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !draft) return;
    setTitle(draft.title);
    const initial = Array.from(new Set((initialTags ?? []).map(normalizeTagName).filter(Boolean)));
    setSelected(initial);
    setTagInput('');
    setReminderEnabled(initial.includes('reminder'));
    setReminderValue(defaultReminderLocal(draft.releaseDate));
    void fetch('/api/watchlist/tags')
      .then((r) => (r.ok ? (r.json() as Promise<KnownTag[]>) : []))
      .then(setKnownTags)
      .catch(() => setKnownTags([]));
  }, [open, draft, initialTags]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const suggestions = useMemo(() => {
    const q = normalizeTagName(tagInput);
    return knownTags
      .filter((t) => !selectedSet.has(t.name))
      .filter((t) => (q ? t.name.includes(q) : true))
      .slice(0, 8);
  }, [knownTags, tagInput, selectedSet]);

  const addTag = useCallback((raw: string) => {
    const name = normalizeTagName(raw);
    if (!name) return;
    setSelected((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setTagInput('');
  }, []);

  const removeTag = useCallback((name: string) => {
    setSelected((prev) => prev.filter((t) => t !== name));
  }, []);

  function colorFor(name: string): string | undefined {
    return knownTags.find((t) => t.name === name)?.color ?? undefined;
  }

  async function handleSave() {
    if (!draft) return;
    const cleanedTitle = title.trim();
    if (!cleanedTitle) {
      toast.error('Title is required');
      titleRef.current?.focus();
      return;
    }
    let reminderAt: string | null | undefined = undefined;
    if (reminderEnabled) {
      if (!reminderValue) {
        toast.error('Pick a reminder date');
        return;
      }
      const d = new Date(reminderValue);
      if (!Number.isFinite(d.getTime())) {
        toast.error('Invalid reminder date');
        return;
      }
      if (d.getTime() < Date.now() - 60_000) {
        toast.error('Reminder must be in the future');
        return;
      }
      reminderAt = d.toISOString();
    } else {
      // Explicitly clear any prior reminder so the dialog can be used to remove one.
      reminderAt = null;
    }
    setSaving(true);
    try {
      const pending = tagInput.trim();
      const tagsToSend = pending ? [...selected, normalizeTagName(pending)] : selected;
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: draft.source,
          externalId: draft.externalId,
          mediaType: draft.mediaType,
          title: cleanedTitle,
          year: draft.year ?? null,
          posterUrl: draft.posterUrl ?? null,
          overview: draft.overview ?? null,
          rating: draft.rating ?? null,
          tags: tagsToSend,
          reminderAt,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error ?? 'Failed to save');
        return;
      }
      const data = (await res.json()) as { created: boolean };
      const reminderMsg = reminderEnabled ? ' · reminder set' : '';
      toast.success((data.created ? 'Added to watchlist' : 'Watchlist updated') + reminderMsg);
      onOpenChange(false);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to watchlist</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wl-title">Title</Label>
            <Input
              id="wl-title"
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="wl-tag-input">Tags</Label>
            <div className="flex flex-wrap gap-1.5 min-h-[28px]">
              {selected.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border"
                  style={{
                    backgroundColor: `${colorFor(t) ?? '#6366f1'}22`,
                    borderColor: `${colorFor(t) ?? '#6366f1'}55`,
                    color: colorFor(t) ?? undefined,
                  }}
                >
                  {t}
                  <button
                    type="button"
                    aria-label={`Remove ${t}`}
                    onClick={() => removeTag(t)}
                    className="opacity-70 hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <Input
              id="wl-tag-input"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag(tagInput);
                } else if (e.key === 'Backspace' && !tagInput && selected.length > 0) {
                  removeTag(selected[selected.length - 1]);
                }
              }}
              placeholder="Type a tag and press Enter"
              disabled={saving}
            />
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => addTag(t.name)}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
                    style={{ borderColor: `${t.color ?? '#6366f1'}55` }}
                  >
                    <Plus className="h-3 w-3" />
                    {t.name}
                    <span className="text-muted-foreground">· {t.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={reminderEnabled}
                onChange={(e) => setReminderEnabled(e.target.checked)}
                disabled={saving}
                className="h-4 w-4 accent-primary"
              />
              <Bell className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">Remind me on release</span>
            </label>
            {reminderEnabled && (
              <>
                <Input
                  type="datetime-local"
                  value={reminderValue}
                  onChange={(e) => setReminderValue(e.target.value)}
                  disabled={saving}
                />
                <p className="text-[11px] text-muted-foreground">
                  We&apos;ll send a push notification on this date.
                </p>
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !draft}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
