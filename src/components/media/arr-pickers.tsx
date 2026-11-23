'use client';

import * as React from 'react';
import { Check, Search } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/page-spinner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchInput } from '@/components/media/search-input';
import { cn } from '@/lib/utils';
import type { SonarrEpisode, ArrLanguage, ArrQualityModel } from '@/types';

// Pickers shared by Manage files, Manual import and interactive search's
// Manual grab: the same screens wherever a series, episodes, quality or
// languages are chosen for something the *arr couldn't place itself.

// ── Series / movie picker (full screen) ───────────────────────────────────────

/** A series or movie offered when the *arr couldn't match something itself. */
export type MediaOption = { id: number; title: string; year?: number };

export function MediaPicker({
  kind, subtitle, options, loading, error, selectedId, disabled, historyKey, onBack, onSelect,
}: {
  kind: 'series' | 'movie';
  subtitle?: string;
  options: MediaOption[];
  loading: boolean;
  error: boolean;
  selectedId?: number;
  disabled?: boolean;
  historyKey: string;
  onBack: () => void;
  onSelect: (option: MediaOption) => void;
}) {
  const [search, setSearch] = React.useState('');
  const plural = kind === 'series' ? 'series' : 'movies';
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return options
      .filter((m) => !q || m.title.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [options, search]);

  return (
    <div
      className="fixed inset-y-0 right-0 left-[var(--app-main-left,0px)] z-50 flex flex-col bg-background pl-[calc(var(--main-pad-x)+var(--main-inset-left))] pr-[calc(var(--main-pad-x)+var(--main-inset-right))] pt-[calc(env(safe-area-inset-top)+var(--main-pad-top))]"
      style={{ '--header-height': '0px' } as React.CSSProperties}
    >
      <PageHeader
        title={kind === 'series' ? 'Select Series' : 'Select Movie'}
        subtitle={subtitle}
        onBack={onBack}
      />

      <div className="py-2 border-b border-border">
        <SearchInput
          clearable
          value={search}
          onChange={setSearch}
          historyKey={historyKey}
          placeholder={`Search ${plural}…`}
          autoFocus
          className="w-full text-sm bg-muted/40 rounded-lg pl-9 pr-3 py-2.5 h-auto shadow-none border-0 outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary/40 transition-shadow"
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        </SearchInput>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain pb-[var(--footer-height)]">
        {loading ? (
          <PageSpinner />
        ) : error ? (
          <p className="text-center py-12 text-sm text-muted-foreground">Couldn&apos;t load the {kind} list</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-12 text-sm text-muted-foreground">No {plural} match</p>
        ) : (
          filtered.map((option) => {
            const isSelected = selectedId === option.id;
            return (
              <button
                key={option.id}
                onClick={() => onSelect(option)}
                disabled={disabled}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted/60 disabled:opacity-60 ${
                  isSelected ? 'bg-primary/8' : 'hover:bg-muted/40'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{option.title}</p>
                  {option.year ? <p className="text-[11px] text-muted-foreground mt-0.5">{option.year}</p> : null}
                </div>
                {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Episode picker (multi-select, full screen) ────────────────────────────────
export function EpisodePicker({ episodes, initial, isAnime = false, onCancel, onConfirm }: {
  episodes: SonarrEpisode[];
  initial: { id: number }[];
  /** Show each episode's absolute number, as Sonarr does for anime. */
  isAnime?: boolean;
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
            className="w-full rounded-lg bg-muted/40 py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground" />
        </div>
      </div>
      <div className="pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {filtered.map(([season, eps]) => (
          <div key={season}>
            <div
              className="sticky z-10 border-b border-border/50 app-chrome-bar bg-background/95 py-2 backdrop-blur-sm"
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
                    {(ep.airDate || (isAnime && ep.absoluteEpisodeNumber != null)) && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {[isAnime && ep.absoluteEpisodeNumber != null ? `Absolute ${ep.absoluteEpisodeNumber}` : null, ep.airDate].filter(Boolean).join(' · ')}
                      </p>
                    )}
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
export function SeasonPicker({ open, episodes, description = 'Reassign the selected files to a season.', onClose, onSelect }: {
  open: boolean; episodes: SonarrEpisode[]; description?: string; onClose: () => void; onSelect: (s: number) => void;
}) {
  const seasons = React.useMemo(() => [...new Set(episodes.map((e) => e.seasonNumber))].sort((a, b) => b - a), [episodes]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Select Season</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
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

export function QualityPicker({ open, defs, loading, initial, description = 'Set quality on the selected files.', onClose, onSelect }: {
  open: boolean; defs: { id: number; quality: ArrQualityModel['quality'] }[]; loading: boolean;
  /** Opens on this quality instead of empty (Manual grab starts from the release's own). */
  initial?: ArrQualityModel;
  description?: string;
  onClose: () => void; onSelect: (q: ArrQualityModel) => void;
}) {
  const [id, setId] = React.useState('');
  const [proper, setProper] = React.useState(false);
  const [real, setReal] = React.useState(false);
  const initialDefId = initial ? defs.find((d) => d.quality.id === initial.quality.id)?.id : undefined;
  const initialProper = (initial?.revision?.version ?? 1) > 1;
  const initialReal = (initial?.revision?.real ?? 0) > 0;
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset quality and revision choices each time the quality picker opens (to `initial` when given)
  React.useEffect(() => { if (open) { setId(initialDefId !== undefined ? String(initialDefId) : ''); setProper(initialProper); setReal(initialReal); } }, [open, initialDefId, initialProper, initialReal]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Select Quality</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
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

export function LanguagePicker({ open, languages, loading, initial, description = 'Set languages on the selected files.', onClose, onSelect }: {
  open: boolean; languages: ArrLanguage[]; loading: boolean;
  /** Opens with these ticked instead of none (Manual grab starts from the release's own). */
  initial?: ArrLanguage[];
  description?: string;
  onClose: () => void; onSelect: (l: ArrLanguage[]) => void;
}) {
  const [picked, setPicked] = React.useState<Set<number>>(new Set());
  const [filter, setFilter] = React.useState('');
  const initialIds = initial?.map((l) => l.id).join(',') ?? '';
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset selected languages and search text each time the language picker opens (to `initial` when given)
  React.useEffect(() => { if (open) { setPicked(new Set(initialIds ? initialIds.split(',').map(Number) : [])); setFilter(''); } }, [open, initialIds]);
  const q = filter.trim().toLowerCase();
  const list = q ? languages.filter((l) => l.name.toLowerCase().includes(q)) : languages;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Select Language</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
        </DialogHeader>
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={loading ? 'Loading…' : 'Filter languages'} />
        <div className="max-h-[45dvh] overflow-y-auto rounded-md border">
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={picked.size === 0} onClick={() => onSelect(languages.filter((l) => picked.has(l.id)))}>Select Languages</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
