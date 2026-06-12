'use client';

import { useState } from 'react';
import {
  Eye, EyeOff, Tags, Search, Trash2, X, Loader2, Plus, CheckCheck,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/lib/store';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { buttonVariants } from '@/components/ui/button';

export interface BulkTag {
  id: number;
  label: string;
}

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
  onApplyTags?: (tagLabels: string[], mode: 'add' | 'remove') => Promise<void>;
  onSearch: () => Promise<void>;
  onDelete?: (deleteFiles: boolean) => Promise<void>;
  /** Singular noun for the affected items, e.g. "movie" — used in the delete prompt. */
  itemNoun?: string;
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
}: BulkActionBarProps) {
  const navAtBottom = useUIStore((s) => s.navPosition === 'bottom');
  const [busy, setBusy] = useState<string | null>(null);

  // Tag popover state — picked entries are labels (resolved to ids server-side).
  const [tagOpen, setTagOpen] = useState(false);
  const [tagMode, setTagMode] = useState<'add' | 'remove'>('add');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [newLabel, setNewLabel] = useState('');

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);

  const disabled = count === 0 || busy !== null;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
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
    setPicked((prev) => new Set(prev).add(label));
    setNewLabel('');
  }

  async function handleApplyTags() {
    if (picked.size === 0 || !onApplyTags) return;
    await run('tags', async () => {
      await onApplyTags([...picked], tagMode);
    });
    setTagOpen(false);
    setPicked(new Set());
  }

  // Labels the user picked that aren't in the suggestion list (e.g. newly typed).
  const extraLabels = [...picked].filter(
    (label) => !tags.some((t) => t.label.toLowerCase() === label.toLowerCase())
  );

  const plural = count === 1 ? itemNoun : `${itemNoun}s`;

  return (
    <>
      <div
        className={cn(
          'fixed inset-x-0 z-40 px-2 md:px-6',
          navAtBottom
            ? 'bottom-[calc(3rem+env(safe-area-inset-bottom))] md:bottom-3'
            : 'bottom-[calc(env(safe-area-inset-bottom)+0.5rem)]'
        )}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-1 rounded-xl border bg-background/95 p-1.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
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
                    className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 min-h-[44px] text-sm font-medium transition-colors hover:bg-accent active:bg-accent/80 disabled:opacity-50"
                  >
                    {busy === 'tags' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tags className="h-4 w-4" />}
                    <span className="hidden sm:inline">Tags</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="center" className="w-72 p-3">
                  <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5">
                    {(['add', 'remove'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setTagMode(mode)}
                        className={cn(
                          'rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors',
                          tagMode === mode ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {mode} tags
                      </button>
                    ))}
                  </div>

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
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm bg-primary/10 text-primary transition-colors"
                          >
                            <Checkbox checked className="pointer-events-none" />
                            <span className="truncate">{label}</span>
                            <span className="ml-auto text-[10px] uppercase opacity-70">new</span>
                          </button>
                        ))}
                        {tags.map((tag) => (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => togglePicked(tag.label)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                              picked.has(tag.label) ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                            )}
                          >
                            <Checkbox checked={picked.has(tag.label)} className="pointer-events-none" />
                            <span className="truncate">{tag.label}</span>
                          </button>
                        ))}
                      </>
                    )}
                  </div>

                  {tagMode === 'add' && (
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
                    {tagMode === 'add' ? 'Add' : 'Remove'} {picked.size > 0 ? `${picked.size} ` : ''}tag{picked.size === 1 ? '' : 's'}
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
                label="Delete"
                destructive
                disabled={disabled}
                onClick={() => {
                  setDeleteFiles(false);
                  setDeleteOpen(true);
                }}
              />
            )}
          </div>
        </div>
      </div>

      {variant === 'full' && onDelete && (
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {count} {plural}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes {count === 1 ? 'it' : 'them'} from your library. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={deleteFiles}
                onCheckedChange={(v) => setDeleteFiles(v === true)}
              />
              Also delete files from disk
            </label>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy === 'delete'}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy === 'delete'}
                className={buttonVariants({ variant: 'destructive' })}
                onClick={(event) => {
                  event.preventDefault();
                  void run('delete', async () => {
                    await onDelete(deleteFiles);
                    setDeleteOpen(false);
                  });
                }}
              >
                {busy === 'delete' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
