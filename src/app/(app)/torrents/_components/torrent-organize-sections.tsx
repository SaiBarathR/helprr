'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, ChevronUp, Loader2, Plus, X } from 'lucide-react';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { QueueMove } from '@/lib/qbittorrent-client';
import { newTagProblem } from './torrent-tags';
import { useTorrentAction, useTorrentOptions } from './use-torrent';

// Shared by one torrent's Settings page and the bulk page; `hash` is one hash
// or several joined with '|'.

/** The save path; tapping it opens an inline editor that moves the files. */
export function TorrentLocationSection({
  hash,
  savePath,
  onSaved,
}: {
  hash: string;
  /** null when the torrents are in different folders. */
  savePath: string | null;
  onSaved: (location: string) => void;
}) {
  const runAction = useTorrentAction();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent) => {
    // A form, so the keyboard's return key saves too.
    event.preventDefault();
    const location = value.trim();
    if (!location) {
      toast.error('Enter a folder');
      return;
    }
    setSaving(true);
    const ok = await runAction({ hash, action: 'setLocation', location });
    setSaving(false);
    if (!ok) return;
    setEditing(false);
    onSaved(location);
    toast.success('Moving to the new location');
  };

  return (
    <GroupedSection title="Location">
      {editing ? (
        <form className="grouped-row grouped-row-stacked gap-3" onSubmit={save}>
          <span className="text-sm">Save Path</span>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="/downloads/movies"
            aria-label="Save Path"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            qBittorrent moves the files there and turns off Auto Torrent Management. The folder must be inside one of
            its download folders.
          </p>
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="flex-1" disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Move'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="grouped-row w-full gap-3 text-left hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors"
          onClick={() => {
            setValue(savePath ?? '');
            setEditing(true);
          }}
        >
          <span className="text-sm shrink-0">Save Path</span>
          <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            <span className="truncate">{savePath ?? 'Mixed'}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          </span>
        </button>
      )}
    </GroupedSection>
  );
}

/** The torrents' tags: remove one, add a new one, or add one qBittorrent already has. */
export function TorrentTagsSection({
  hash,
  tagsByTorrent,
  onChanged,
}: {
  hash: string;
  /** Each torrent's tags, one entry per torrent. */
  tagsByTorrent: string[][];
  onChanged: (action: 'addTags' | 'removeTags', tag: string) => void;
}) {
  const runAction = useTorrentAction();
  const options = useTorrentOptions();
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);

  const total = tagsByTorrent.length;
  const counts = new Map<string, number>();
  for (const tags of tagsByTorrent) {
    for (const tag of new Set(tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const applied = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  const suggestions = (options.data?.tags ?? [])
    .filter((tag) => (counts.get(tag) ?? 0) < total)
    .sort((a, b) => a.localeCompare(b));

  const change = async (action: 'addTags' | 'removeTags', tag: string) => {
    setPending(true);
    const ok = await runAction({ hash, action, tags: [tag] });
    setPending(false);
    if (ok) {
      onChanged(action, tag);
      toast.success(action === 'addTags' ? `Tagged “${tag}”` : `Removed tag “${tag}”`);
    }
    return ok;
  };

  const addNew = async (event: FormEvent) => {
    event.preventDefault();
    const problem = newTagProblem(value);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (await change('addTags', value.trim())) {
      setValue('');
      // qBittorrent made the tag if it was new; offer it next time.
      void options.refetch();
    }
  };

  return (
    <GroupedSection title="Tags">
      {applied.length === 0 && (
        <div className="grouped-row">
          <span className="text-sm text-muted-foreground">No tags</span>
        </div>
      )}
      {applied.map((tag) => {
        const count = counts.get(tag) ?? 0;
        return (
          <div key={tag} className="grouped-row gap-3">
            <span className="min-w-0 truncate text-sm">{tag}</span>
            <span className="flex shrink-0 items-center gap-2">
              {count < total && <span className="text-xs text-muted-foreground">{count} of {total}</span>}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove tag ${tag}`}
                disabled={pending}
                onClick={() => void change('removeTags', tag)}
              >
                <X className="h-4 w-4" />
              </Button>
            </span>
          </div>
        );
      })}
      <form className="grouped-row grouped-row-stacked gap-3" onSubmit={addNew}>
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="New tag"
            aria-label="New tag"
            autoCapitalize="off"
            autoCorrect="off"
            className="flex-1"
          />
          <Button type="submit" disabled={pending || !value.trim()}>
            Add
          </Button>
        </div>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-x-2 gap-y-3">
            {suggestions.map((tag) => (
              <Button
                key={tag}
                type="button"
                variant="outline"
                size="sm"
                className="max-w-full"
                aria-label={`Add tag ${tag}`}
                disabled={pending}
                onClick={() => void change('addTags', tag)}
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="truncate">{tag}</span>
              </Button>
            ))}
          </div>
        )}
      </form>
    </GroupedSection>
  );
}

const QUEUE_MOVES: { move: QueueMove; label: string; done: string; Icon: typeof ChevronUp }[] = [
  { move: 'topPrio', label: 'Top', done: 'Moved to the top of the queue', Icon: ChevronsUp },
  { move: 'increasePrio', label: 'Up', done: 'Moved up the queue', Icon: ChevronUp },
  { move: 'decreasePrio', label: 'Down', done: 'Moved down the queue', Icon: ChevronDown },
  { move: 'bottomPrio', label: 'Bottom', done: 'Moved to the bottom of the queue', Icon: ChevronsDown },
];

/** Moves the torrents in qBittorrent's queue; only possible while its queueing is on. */
export function TorrentQueueSection({
  hash,
  position,
  onMoved,
}: {
  hash: string;
  /** One torrent's queue position (qBittorrent's `priority`; 0 when it is not queued). */
  position?: number;
  onMoved?: () => void;
}) {
  const runAction = useTorrentAction();
  const options = useTorrentOptions();
  const [pending, setPending] = useState(false);
  const queueingOff = options.data?.queueingEnabled === false;

  const move = async ({ move: action, done }: (typeof QUEUE_MOVES)[number]) => {
    setPending(true);
    const ok = await runAction({ hash, action });
    setPending(false);
    if (ok) {
      toast.success(done);
      onMoved?.();
    }
  };

  return (
    <GroupedSection title="Queue">
      {position !== undefined && !queueingOff && (
        <div className="grouped-row">
          <span className="text-sm">Position</span>
          <span className="text-sm text-muted-foreground">{position > 0 ? position : 'Not queued'}</span>
        </div>
      )}
      <div className="grouped-row">
        <div className="grid w-full grid-cols-4 gap-2">
          {QUEUE_MOVES.map((entry) => (
            <Button
              key={entry.move}
              type="button"
              variant="outline"
              className="px-2"
              aria-label={entry.done.replace('Moved', 'Move')}
              disabled={queueingOff || pending}
              onClick={() => void move(entry)}
            >
              <entry.Icon className="h-4 w-4" />
              {entry.label}
            </Button>
          ))}
        </div>
      </div>
      {queueingOff && (
        <div className="grouped-row">
          <span className="text-xs text-muted-foreground">
            Queueing is off in qBittorrent. Turn on Torrent Queueing in its BitTorrent options to order torrents.
          </span>
        </div>
      )}
    </GroupedSection>
  );
}
