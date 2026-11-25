'use client';

import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { CheckCheck, Layers, ListOrdered, Loader2, Minus, MoreHorizontal, Plus, Power, PowerOff, Tags, Trash2, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FloatingActionBar } from '@/components/ui/floating-action-bar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useIsMobile } from '@/hooks/use-is-mobile';
import type { ProwlarrAppProfile, ProwlarrIndexerSummary } from '@/lib/prowlarr-client';
import { cn } from '@/lib/utils';
import type { Tag } from '@/types/arr';
import type { IndexerActions } from './use-indexer-actions';

const MIN_PRIORITY = 1;
const MAX_PRIORITY = 50;
const DEFAULT_PRIORITY = 25;

/** A bar button as on the library pages' bulk bar: icon only below sm, named for screen readers. */
function BarAction({ icon: Icon, label, busy, destructive, className, ...props }: ComponentProps<'button'> & {
  icon: LucideIcon;
  label: string;
  busy?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 min-h-[44px] text-sm font-medium transition-colors disabled:opacity-50',
        destructive ? 'text-destructive hover:bg-destructive/10 active:bg-destructive/20' : 'hover:bg-accent active:bg-accent/80',
        className,
      )}
      {...props}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

type Picker = 'priority' | 'profile' | 'tags';

const plural = (count: number) => (count === 1 ? '1 indexer' : `${count} indexers`);

/**
 * Select mode's actions on the chosen indexers: enable, disable, priority,
 * app profile, tags and delete, each one request for all of them.
 */
export function IndexerBulkBar({
  selected,
  allSelected,
  onToggleAll,
  onCancel,
  onDeleted,
  tags,
  profiles,
  actions,
}: {
  /** The selected indexers still in the list shown; actions apply to these only. */
  selected: ProwlarrIndexerSummary[];
  allSelected: boolean;
  onToggleAll: () => void;
  onCancel: () => void;
  onDeleted: () => void;
  tags: Tag[];
  profiles: ProwlarrAppProfile[];
  actions: IndexerActions;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  // 'more': the phone's More list, which then shows the picker chosen from it.
  const [open, setOpen] = useState<Picker | 'more' | null>(null);
  const [priority, setPriority] = useState(DEFAULT_PRIORITY);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [tagMode, setTagMode] = useState<'add' | 'remove'>('add');
  const [pickedTags, setPickedTags] = useState<number[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // `busy` is state, so a double tap could start two requests before it renders.
  const running = useRef(false);
  const count = selected.length;
  const disabled = count === 0 || busy !== null;
  // Below sm the buttons lose their names, and a 320 px phone still has no room
  // for all of them: Priority, App profile and Tags move into More actions, so
  // Delete stays in view instead of behind a sideways scroll.
  const compact = useIsMobile(639.98);

  async function run(key: string, work: () => Promise<boolean>) {
    if (running.current) return false;
    running.current = true;
    setBusy(key);
    try {
      return await work();
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  function openPicker(picker: Picker) {
    // Start from the selection's own value when they all share it.
    if (picker === 'priority') {
      const shared = selected.every((indexer) => indexer.priority === selected[0]?.priority);
      setPriority(shared && selected[0] ? selected[0].priority : DEFAULT_PRIORITY);
    }
    if (picker === 'profile') {
      const shared = selected.every((indexer) => indexer.appProfileId === selected[0]?.appProfileId);
      setProfileId(shared ? selected[0]?.appProfileId ?? null : null);
    }
    if (picker === 'tags') {
      setTagMode('add');
      setPickedTags([]);
    }
    setOpen(picker);
  }

  const setEnabled = (enable: boolean) => run(enable ? 'enable' : 'disable', () => actions.handleBulkEdit(
    selected,
    () => ({ enable }),
    { enable },
    { success: `${enable ? 'Enabled' : 'Disabled'} ${plural(count)}`, failure: `Could not ${enable ? 'enable' : 'disable'} ${plural(count)}` },
  ));

  async function applyPriority() {
    setOpen(null);
    await run('priority', () => actions.handleBulkEdit(
      selected,
      () => ({ priority }),
      { priority },
      { success: `Priority ${priority} set on ${plural(count)}`, failure: `Could not change the priority of ${plural(count)}` },
    ));
  }

  async function applyProfile() {
    if (profileId === null) return;
    setOpen(null);
    const name = profiles.find((profile) => profile.id === profileId)?.name ?? 'App profile';
    await run('profile', () => actions.handleBulkEdit(
      selected,
      () => ({ appProfileId: profileId }),
      { appProfileId: profileId },
      { success: `${name} set on ${plural(count)}`, failure: `Could not change the app profile of ${plural(count)}` },
    ));
  }

  async function applyTags() {
    if (pickedTags.length === 0) return;
    setOpen(null);
    const picked = pickedTags;
    await run('tags', () => actions.handleBulkEdit(
      selected,
      (indexer) => ({
        tags: tagMode === 'add'
          ? [...new Set([...indexer.tags, ...picked])]
          : indexer.tags.filter((tag) => !picked.includes(tag)),
      }),
      { tags: picked, applyTags: tagMode },
      {
        success: tagMode === 'add' ? `Tags added to ${plural(count)}` : `Tags removed from ${plural(count)}`,
        failure: `Could not change the tags of ${plural(count)}`,
      },
    ));
  }

  const names = selected.map((indexer) => indexer.name);
  const listed = names.length > 6 ? `${names.slice(0, 5).join(', ')} and ${names.length - 5} more` : names.join(', ');

  const priorityPicker = (
    <>
      <p className="text-sm font-medium">Priority for {plural(count)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Prowlarr prefers lower numbers.</p>
      <div className="mt-3 flex items-center justify-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          aria-label="Lower the priority number"
          disabled={priority <= MIN_PRIORITY}
          onClick={() => setPriority((value) => Math.max(MIN_PRIORITY, value - 1))}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="w-10 text-center text-lg font-semibold tabular-nums" aria-live="polite">{priority}</span>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          aria-label="Raise the priority number"
          disabled={priority >= MAX_PRIORITY}
          onClick={() => setPriority((value) => Math.min(MAX_PRIORITY, value + 1))}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <Button className="mt-3 h-11 w-full" onClick={() => void applyPriority()}>Set priority</Button>
    </>
  );

  const profilePicker = (
    <>
      <p className="text-sm font-medium">App profile for {plural(count)}</p>
      <div role="radiogroup" aria-label="App profile" className="mt-2 max-h-52 space-y-0.5 overflow-y-auto">
        {profiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            role="radio"
            aria-checked={profileId === profile.id}
            onClick={() => setProfileId(profile.id)}
            className={cn(
              'flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm transition-colors hover:bg-accent',
              profileId === profile.id && 'bg-primary/15 font-medium text-primary',
            )}
          >
            <span className="min-w-0 truncate">{profile.name}</span>
          </button>
        ))}
      </div>
      <Button className="mt-3 h-11 w-full" disabled={profileId === null} onClick={() => void applyProfile()}>
        Set app profile
      </Button>
    </>
  );

  const tagsPicker = (
    <>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5">
        {(['add', 'remove'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setTagMode(mode)}
            aria-pressed={tagMode === mode}
            className={cn(
              'min-h-9 rounded-md px-2 text-xs font-medium transition-colors',
              tagMode === mode ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {mode === 'add' ? 'Add tags' : 'Remove tags'}
          </button>
        ))}
      </div>
      {tags.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No tags in Prowlarr yet.</p>
      ) : (
        <div className="mt-2 max-h-52 space-y-0.5 overflow-y-auto">
          {tags.map((tag) => (
            <label key={tag.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm hover:bg-accent">
              <Checkbox
                checked={pickedTags.includes(tag.id)}
                onCheckedChange={() => setPickedTags((prev) => (
                  prev.includes(tag.id) ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]
                ))}
              />
              <span className="min-w-0 truncate">{tag.label}</span>
            </label>
          ))}
        </div>
      )}
      <Button className="mt-3 h-11 w-full" disabled={pickedTags.length === 0} onClick={() => void applyTags()}>
        {tagMode === 'add' ? 'Add' : 'Remove'}
      </Button>
    </>
  );

  // With one profile there is nothing to choose.
  const pickers: { key: Picker; icon: LucideIcon; label: string; body: ReactNode }[] = [
    { key: 'priority', icon: ListOrdered, label: 'Priority', body: priorityPicker },
    ...(profiles.length > 1 ? [{ key: 'profile' as const, icon: Layers, label: 'App profile', body: profilePicker }] : []),
    { key: 'tags', icon: Tags, label: 'Tags', body: tagsPicker },
  ];
  const openPickerBody = pickers.find((picker) => picker.key === open)?.body;

  return (
    <>
      <FloatingActionBar className="gap-1 p-1.5">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel selection"
          className="flex shrink-0 items-center justify-center rounded-lg p-2 min-h-[44px] min-w-[44px] hover:bg-accent active:bg-accent/80 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="shrink-0 px-1 text-sm font-semibold tabular-nums" aria-label={`${plural(count)} selected`}>{count}</span>
        <BarAction icon={CheckCheck} label={allSelected ? 'Clear' : 'All'} onClick={onToggleAll} />
        <div className="mx-0.5 h-6 w-px shrink-0 bg-border" />
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto scrollbar-hide">
          <BarAction icon={Power} label="Enable" disabled={disabled} busy={busy === 'enable'} onClick={() => void setEnabled(true)} />
          <BarAction icon={PowerOff} label="Disable" disabled={disabled} busy={busy === 'disable'} onClick={() => void setEnabled(false)} />

          {compact ? (
            <Popover open={open !== null} onOpenChange={(next) => setOpen(next ? 'more' : null)}>
              <PopoverTrigger asChild>
                <BarAction
                  icon={MoreHorizontal}
                  label="More actions"
                  disabled={disabled}
                  busy={busy === 'priority' || busy === 'profile' || busy === 'tags'}
                />
              </PopoverTrigger>
              <PopoverContent side="top" align="center" className="w-64 p-3">
                {openPickerBody ?? (
                  <div role="menu" aria-label="More actions" className="-m-1.5 space-y-0.5">
                    {pickers.map(({ key, icon: Icon, label }) => (
                      <button
                        key={key}
                        type="button"
                        role="menuitem"
                        onClick={() => openPicker(key)}
                        className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors hover:bg-accent"
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          ) : pickers.map(({ key, icon, label, body }) => (
            <Popover key={key} open={open === key} onOpenChange={(next) => (next ? openPicker(key) : setOpen(null))}>
              <PopoverTrigger asChild>
                <BarAction icon={icon} label={label} disabled={disabled} busy={busy === key} />
              </PopoverTrigger>
              <PopoverContent side="top" align="center" className="w-64 p-3">{body}</PopoverContent>
            </Popover>
          ))}

          <BarAction
            icon={Trash2}
            label="Delete"
            destructive
            disabled={disabled}
            busy={actions.bulkDeleting}
            onClick={() => setConfirmDelete(true)}
          />
        </div>
      </FloatingActionBar>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(next) => { if (!next && !actions.bulkDeleting) setConfirmDelete(false); }}
        title={count === 1 ? 'Delete 1 indexer?' : `Delete ${count} indexers?`}
        description={`${listed}. This cannot be undone.`}
        confirmLabel={count === 1 ? 'Delete indexer' : `Delete ${count} indexers`}
        destructive
        busy={actions.bulkDeleting}
        onConfirm={async () => {
          const ok = await run('delete', () => actions.handleBulkDelete(selected));
          setConfirmDelete(false);
          if (ok) onDeleted();
        }}
      />
    </>
  );
}
