'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@/lib/query-fetch';
import { Loader2, Plus, X } from 'lucide-react';
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
  releaseDate?: string | null;
}

interface KnownTag {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

// Module-level cache so re-opening the dialog (or opening it from many cards
// in quick succession) doesn't refetch the tag list every time.
const TAG_CACHE_TTL_MS = 60_000;
let tagCache: { at: number; tags: KnownTag[] } | null = null;
let tagInFlight: Promise<KnownTag[]> | null = null;

async function fetchKnownTags(): Promise<KnownTag[]> {
  const now = Date.now();
  if (tagCache && now - tagCache.at < TAG_CACHE_TTL_MS) return tagCache.tags;
  if (tagInFlight) return tagInFlight;
  tagInFlight = fetch('/api/watchlist/tags')
    .then((r) => {
      if (!r.ok) throw new Error(`tags fetch failed: ${r.status}`);
      return r.json() as Promise<KnownTag[]>;
    })
    .then((tags) => {
      // Only memoize successful responses — caching `[]` on a transient 500
      // would hide all tag suggestions for the full TTL window.
      tagCache = { at: Date.now(), tags };
      return tags;
    })
    .catch(() => [] as KnownTag[])
    .finally(() => {
      tagInFlight = null;
    });
  return tagInFlight;
}

export function invalidateWatchlistTagCache(): void {
  tagCache = null;
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
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !draft) return;
    setTitle(draft.title);
    const initial = Array.from(new Set((initialTags ?? []).map(normalizeTagName).filter(Boolean)));
    setSelected(initial);
    setTagInput('');
    void fetchKnownTags().then(setKnownTags);
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

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new ApiError(res.status, err?.error ?? 'Failed to save');
      }
      return res.json() as Promise<{ created: boolean }>;
    },
    onSuccess: (data) => {
      toast.success(data.created ? 'Added to watchlist' : 'Watchlist updated');
      // New tags may have been created by ensureTagIds on the server; drop
      // the cache so the next dialog open sees them.
      invalidateWatchlistTagCache();
      onOpenChange(false);
      onSaved?.();
    },
    onError: (err) => {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    },
  });
  const saving = saveMutation.isPending;

  function handleSave() {
    if (!draft) return;
    const cleanedTitle = title.trim();
    if (!cleanedTitle) {
      toast.error('Title is required');
      titleRef.current?.focus();
      return;
    }
    const pending = tagInput.trim();
    const tagsToSend = pending ? [...selected, normalizeTagName(pending)] : selected;
    saveMutation.mutate({
      source: draft.source,
      externalId: draft.externalId,
      mediaType: draft.mediaType,
      title: cleanedTitle,
      year: draft.year ?? null,
      posterUrl: draft.posterUrl ?? null,
      overview: draft.overview ?? null,
      rating: draft.rating ?? null,
      tags: tagsToSend,
    });
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
