'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Eye, EyeOff, Tags, Search, Trash2, X, Loader2, Plus, CheckCheck, Check,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/lib/store';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { buttonVariants } from '@/components/ui/button';
import { MediaDeleteConfirmDialog } from '@/components/media/media-delete-confirm-dialog';

export interface BulkTag {
  id: number;
  label: string;
}

export type BulkTagApplyMode = 'add' | 'remove' | 'replace';

interface BulkActionBarProps {
  count: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onCancel: () => void;
  /** 'full' = monitor/tags/search/delete (library pages); 'search' = search only (gaps). */
  variant?: 'full' | 'search';
  canMonitor?: boolean;
  canTag?: boolean;
  canSearch?: boolean;
  canDelete?: boolean;
  /** Existing tags shown as suggestions; applying resolves by label server-side. */
  tags?: BulkTag[];
  onMonitor?: (monitored: boolean) => Promise<void>;
  onApplyTags?: (tagLabels: string[], mode: BulkTagApplyMode) => Promise<void>;
  onSearch: () => Promise<void>;
  onDelete?: (deleteFiles: boolean) => Promise<void>;
  /** Singular noun for the affected items, e.g. "movie" — used in the delete prompt. */
  itemNoun?: string;
  /** When true, show a Merge / Replace toggle above add/remove in the tag popover. */
  allowReplace?: boolean;
  /** Show the "Also delete files from disk" checkbox in the delete dialog. Default true (library pages). */
  deleteFilesOption?: boolean;
  /** Verb for the delete action button + dialog (e.g. "Remove" for the watchlist). Default "Delete". */
  deleteVerb?: string;
  /** Override the delete dialog description. */
  deleteDescription?: string;
}

function TagPickMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-background'
      )}
    >
      {checked && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

function BarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  busy,
  destructive,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // The text label is hidden on small screens, so name the button for SR users.
      aria-label={label}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 min-h-[44px] text-sm font-medium transition-colors disabled:opacity-50',
        destructive
          ? 'text-destructive hover:bg-destructive/10 active:bg-destructive/20'
          : 'hover:bg-accent active:bg-accent/80'
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function BulkActionBar({
  count,
  allSelected,
  onToggleSelectAll,
  onCancel,
  variant = 'full',
  canMonitor,
  canTag,
  canSearch = true,
  canDelete,
  tags = [],
  onMonitor,
  onApplyTags,
  onSearch,
  onDelete,
  itemNoun = 'item',
  allowReplace = false,
  deleteFilesOption = true,
  deleteVerb = 'Delete',
  deleteDescription,
}: BulkActionBarProps) {
  const navAtBottom = useUIStore((s) => s.navPosition === 'bottom');
  const [busy, setBusy] = useState<string | null>(null);

  // Tag popover state — picked entries are labels (resolved to ids server-side).
  const [tagOpen, setTagOpen] = useState(false);
  const [tagStrategy, setTagStrategy] = useState<'merge' | 'replace'>('merge');
  const [tagMode, setTagMode] = useState<'add' | 'remove'>('add');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [newLabel, setNewLabel] = useState('');

  const isReplace = allowReplace && tagStrategy === 'replace';

  // Clear staged labels when the popover closes so reopening starts fresh.
  useEffect(() => {
    if (!tagOpen) {
      setPicked(new Set());
      setNewLabel('');
      setTagStrategy('merge');
      setTagMode('add');
    }
  }, [tagOpen]);

  useEffect(() => {
    setPicked(new Set());
    setNewLabel('');
  }, [tagStrategy]);

  // Delete dialog state (the delete-files checkbox lives in the dialog).
  const [deleteOpen, setDeleteOpen] = useState(false);

  const disabled = count === 0 || busy !== null;

  // Synchronous re-entrancy lock: `busy` is state, so a sub-frame double-tap could
  // fire two actions before the disabled prop re-renders. The ref blocks that window.
  const runningRef = useRef(false);

  async function run(key: string, fn: () => Promise<void>) {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
      runningRef.current = false;
    }
  }

  function togglePicked(label: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function addNewLabel() {
    const label = newLabel.trim();
    if (!label) return;
    // Canonicalize to an existing tag's casing so a typed "drama" matches a
    // "Drama" suggestion row (checked state + submission both use the same label).
    const existing = tags.find((t) => t.label.toLowerCase() === label.toLowerCase());
    setPicked((prev) => new Set(prev).add(existing ? existing.label : label));
    setNewLabel('');
  }

  async function handleApplyTags() {
    if (picked.size === 0 || !onApplyTags) return;
    const mode = isReplace ? 'replace' : tagMode;
    await run('tags', async () => {
      await onApplyTags([...picked], mode);
    });
    setTagOpen(false);
  }

  // Labels the user picked that aren't in the suggestion list (e.g. newly typed).
  const extraLabels = [...picked].filter(
    (label) => !tags.some((t) => t.label.toLowerCase() === label.toLowerCase())
  );

  const plural = count === 1 ? itemNoun : `${itemNoun}s`;

  // Portaled to <body> so the bar's `position: fixed` is relative to the viewport.
  // The list pages render under `.animate-content-in`, whose lingering transform
  // (animation-fill-mode: both) would otherwise make this fixed bar a child of the
  // full-height list — pinning it below all rows instead of floating at the bottom.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        className={cn(
          'fixed inset-x-0 z-40 px-2 md:px-6',
          navAtBottom
            ? 'bottom-[calc(3rem+env(safe-area-inset-bottom))] md:bottom-3'
            : 'bottom-[calc(env(safe-area-inset-bottom)+0.5rem)]'
        )}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-1 rounded-xl border app-chrome-bar bg-background/95 p-1.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel selection"
            className="flex shrink-0 items-center justify-center rounded-lg p-2 min-h-[44px] min-w-[44px] hover:bg-accent active:bg-accent/80 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>

          <span className="shrink-0 px-1 text-sm font-semibold tabular-nums">{count}</span>

          <BarButton
            icon={CheckCheck}
            label={allSelected ? 'Clear' : 'All'}
            onClick={onToggleSelectAll}
          />

          <div className="mx-0.5 h-6 w-px shrink-0 bg-border" />

          <div className="flex flex-1 items-center gap-0.5 overflow-x-auto scrollbar-hide">
            {variant === 'full' && canMonitor && onMonitor && (
              <>
                <BarButton
                  icon={Eye}
                  label="Monitor"
                  disabled={disabled}
                  busy={busy === 'monitor'}
                  onClick={() => run('monitor', () => onMonitor(true))}
                />
                <BarButton
                  icon={EyeOff}
                  label="Unmonitor"
                  disabled={disabled}
                  busy={busy === 'unmonitor'}
                  onClick={() => run('unmonitor', () => onMonitor(false))}
                />
              </>
            )}

            {variant === 'full' && canTag && onApplyTags && (
              <Popover open={tagOpen} onOpenChange={setTagOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label="Tags"
                    className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 min-h-[44px] text-sm font-medium transition-colors hover:bg-accent active:bg-accent/80 disabled:opacity-50"
                  >
                    {busy === 'tags' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tags className="h-4 w-4" />}
                    <span className="hidden sm:inline">Tags</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="center" className="w-72 p-3">
                  {allowReplace && (
                    <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5">
                      {(['merge', 'replace'] as const).map((strategy) => (
                        <button
                          key={strategy}
                          type="button"
                          onClick={() => setTagStrategy(strategy)}
                          aria-pressed={tagStrategy === strategy}
                          className={cn(
                            'rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors',
                            tagStrategy === strategy
                              ? 'bg-background shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {strategy}
                        </button>
                      ))}
                    </div>
                  )}

                  {!isReplace && (
                    <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5">
                      {(['add', 'remove'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setTagMode(mode)}
                          aria-pressed={tagMode === mode}
                          className={cn(
                            'rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors',
                            tagMode === mode ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {mode} tags
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="max-h-44 space-y-1 overflow-y-auto">
                    {tags.length === 0 && extraLabels.length === 0 ? (
                      <p className="py-3 text-center text-xs text-muted-foreground">
                        No tags yet — type one below.
                      </p>
                    ) : (
                      <>
                        {extraLabels.map((label) => (
                          <button
                            key={`new:${label}`}
                            type="button"
                            onClick={() => togglePicked(label)}
                            aria-pressed
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm bg-primary/10 text-primary transition-colors"
                          >
                            <TagPickMark checked />
                            <span className="truncate">{label}</span>
                            <span className="ml-auto text-[10px] uppercase opacity-70">new</span>
                          </button>
                        ))}
                        {tags.map((tag) => (
                          <button
                            // Keyed by label, not id: a union of tags across instances can
                            // repeat ids, but labels are de-duped (case-insensitive) upstream.
                            key={tag.label}
                            type="button"
                            onClick={() => togglePicked(tag.label)}
                            aria-pressed={picked.has(tag.label)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                              picked.has(tag.label) ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                            )}
                          >
                            <TagPickMark checked={picked.has(tag.label)} />
                            <span className="truncate">{tag.label}</span>
                          </button>
                        ))}
                      </>
                    )}
                  </div>

                  {(tagMode === 'add' || isReplace) && (
                    <div className="mt-2 flex items-center gap-1.5 border-t pt-2">
                      <input
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addNewLabel();
                          }
                        }}
                        placeholder="New tag…"
                        className="h-8 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <button
                        type="button"
                        onClick={addNewLabel}
                        disabled={!newLabel.trim()}
                        aria-label="Add tag to selection"
                        className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleApplyTags()}
                    disabled={picked.size === 0 || busy !== null}
                    className={cn(buttonVariants({ size: 'sm' }), 'mt-2 w-full')}
                  >
                    {isReplace
                      ? 'Replace'
                      : tagMode === 'add'
                        ? 'Add'
                        : 'Remove'}{' '}
                    {picked.size > 0 ? `${picked.size} ` : ''}tag{picked.size === 1 ? '' : 's'}
                  </button>
                </PopoverContent>
              </Popover>
            )}

            {canSearch && (
              <BarButton
                icon={Search}
                label="Search"
                disabled={disabled}
                busy={busy === 'search'}
                onClick={() => run('search', onSearch)}
              />
            )}

            {variant === 'full' && canDelete && onDelete && (
              <BarButton
                icon={Trash2}
                label={deleteVerb}
                destructive
                disabled={disabled}
                onClick={() => setDeleteOpen(true)}
              />
            )}
          </div>
        </div>
      </div>

      {variant === 'full' && onDelete && (
        <MediaDeleteConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={`${deleteVerb} ${count} ${plural}?`}
          description={
            deleteDescription ??
            `This removes ${count === 1 ? 'it' : 'them'} from your library. This cannot be undone.`
          }
          confirmLabel={deleteVerb}
          showDeleteFiles={deleteFilesOption}
          busy={busy === 'delete'}
          onConfirm={(deleteFiles) =>
            run('delete', async () => {
              await onDelete(deleteFiles);
              setDeleteOpen(false);
            })
          }
        />
      )}
    </>,
    document.body
  );
}
