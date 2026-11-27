'use client';

import { useState } from 'react';
import { Plus, X, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useTags, useCreateTag } from '@/lib/hooks/use-reference-data';
import type { ArrService } from '@/lib/query-keys';

interface TagSelectorProps {
  service: ArrService;
  instanceId?: string;
  value: number[];
  onChange: (ids: number[]) => void;
  /** Applied to the outer wrapper — e.g. `justify-end` for the compact add-page row. */
  className?: string;
}

/**
 * Shared tag picker for the add/edit forms: shows selected tags as removable chips
 * plus a popover to toggle existing tags or create a new one on the spot. Always
 * rendered (even with no tags), so a fresh *arr install can still create its first.
 * Below md the list is the app's bottom sheet, as in ResponsiveCombobox: the
 * popover sat where it opened, so with the keyboard up for its search field
 * the field and Create were behind the keyboard (Collection Edit), and its
 * search took focus at once. The sheet opens with the keyboard down and stays
 * above it once the field is tapped.
 */
export function TagSelector({ service, instanceId, value, onChange, className }: TagSelectorProps) {
  const { data: tags = [] } = useTags(service, instanceId);
  const createTag = useCreateTag(service, instanceId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Tailwind's md starts at 768px, so "below md" is up to 767px.
  const isPhone = useIsMobile(767);
  // While the menu is open, the chips/trigger render from this frozen snapshot of
  // the selection (not live `value`). Otherwise toggling a tag reflows the chips,
  // which shifts the trigger the popover is anchored to — making the menu jump
  // left/right on every (de)select. In-menu checkmarks still reflect live `value`.
  const [frozen, setFrozen] = useState<number[] | null>(null);

  const trimmed = query.trim();
  const filtered = trimmed
    ? tags.filter((t) => t.label.toLowerCase().includes(trimmed.toLowerCase()))
    : tags;
  const exactMatch = tags.some((t) => t.label.toLowerCase() === trimmed.toLowerCase());
  const selected = (frozen ?? value)
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is { id: number; label: string } => Boolean(t));

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  function handleOpenChange(next: boolean) {
    // Freeze on open, release on close so the chips catch up to the final selection.
    setFrozen(next ? value : null);
    if (!next) setQuery('');
    setOpen(next);
  }

  async function handleCreate() {
    if (!trimmed || createTag.isPending) return;
    try {
      const tag = await createTag.mutateAsync(trimmed);
      if (!value.includes(tag.id)) onChange([...value, tag.id]);
      setQuery('');
    } catch {
      toast.error('Failed to create tag');
    }
  }

  // On a phone the keyboard stays down until the field is tapped (see above).
  const search = (
    <input
      autoFocus={!isPhone}
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (trimmed && !exactMatch) void handleCreate();
        }
      }}
      placeholder="Search or create a tag…"
      className={cn(
        'w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isPhone ? 'h-11' : 'mb-2 h-8',
      )}
    />
  );

  const trigger = (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground hover:bg-accent/40 transition-colors"
    >
      <Plus className="h-3 w-3" />
      {selected.length === 0 ? 'Add tags' : 'Add'}
    </button>
  );

  const rows = (
    <>
      {filtered.map((tag) => (
        <button
          key={tag.id}
          type="button"
          onClick={() => toggle(tag.id)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors pointer-coarse:min-h-11',
            value.includes(tag.id) ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
          )}
        >
          {/* Plain visual box (not a Radix Checkbox, which is itself a <button>
              and would nest a button inside this row's button). */}
          <span
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
              value.includes(tag.id)
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input'
            )}
          >
            {value.includes(tag.id) && <Check className="h-3 w-3" />}
          </span>
          <span className="truncate">{tag.label}</span>
        </button>
      ))}

      {trimmed && !exactMatch && (
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={createTag.isPending}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50 pointer-coarse:min-h-11"
        >
          {createTag.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          <span className="truncate">
            Create &ldquo;{trimmed}&rdquo;
          </span>
        </button>
      )}

      {tags.length === 0 && !trimmed && (
        <p className="py-3 text-center text-xs text-muted-foreground">
          No tags yet — type to create one.
        </p>
      )}
    </>
  );

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {selected.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => toggle(t.id)}
          className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary"
        >
          {t.label}
          <X className="h-3 w-3" />
        </button>
      ))}

      {isPhone ? (
        <Drawer open={open} onOpenChange={handleOpenChange}>
          <DrawerTrigger asChild>{trigger}</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Tags</DrawerTitle>
            </DrawerHeader>
            <div className="shrink-0 px-4 pb-2">{search}</div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-4 pb-2">{rows}</div>
            <div className="shrink-0 border-t border-border px-2 py-2">
              <DrawerClose asChild>
                <Button className="w-full">Done</Button>
              </DrawerClose>
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2">
            {search}
            <div className="max-h-48 space-y-0.5 overflow-y-auto">{rows}</div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
