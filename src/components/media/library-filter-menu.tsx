'use client';

import { Fragment, useMemo, useState } from 'react';
import { Bookmark, Check, Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ActiveFilter } from '@/components/ui/active-filter-bar';
import {
  ResponsiveMenuActionItem,
  ResponsiveMenuCheckboxItem,
  ResponsiveMenuLabel,
  ResponsiveMenuSeparator,
} from '@/components/ui/responsive-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  LIBRARY_FACET_KEYS,
  libraryFacetOptions,
  type LibraryFacetFilters,
  type LibraryFacetKey,
  type LibraryFacetOption,
} from '@/lib/library-filtering';
import {
  SAVED_FILTER_NAME_MAX,
  hasLibraryFilterState,
  renameSavedLibraryFilter,
  sameLibraryFilterState,
  saveLibraryFilter,
  type LibraryFilterState,
  type SavedLibraryFilter,
} from '@/lib/library-saved-filters';

const FACET_TITLES: Record<LibraryFacetKey, string> = {
  tags: 'Tag',
  qualityProfiles: 'Quality profile',
  rootFolders: 'Root folder',
  genres: 'Genre',
};

interface FacetGroup {
  key: LibraryFacetKey;
  title: string;
  options: LibraryFacetOption[];
  selected: string[];
}

function optionLabel(option: LibraryFacetOption): string {
  return option.hint ? `${option.label} (${option.hint})` : option.label;
}

/**
 * The tag, quality profile, root folder and genre groups of a library page's
 * filter menu, and their chips for the active-filter bar, from the loaded items.
 */
export function useLibraryFacetFilters(
  items: Parameters<typeof libraryFacetOptions>[0],
  facets: LibraryFacetFilters,
  setFacets: (next: LibraryFacetFilters) => void,
) {
  const options = useMemo(() => libraryFacetOptions(items, facets), [items, facets]);
  const groups: FacetGroup[] = LIBRARY_FACET_KEYS.map((key) => ({
    key,
    title: FACET_TITLES[key],
    options: options[key],
    selected: facets[key],
  }));
  const toggle = (key: LibraryFacetKey, value: string) => {
    const selected = facets[key];
    setFacets({
      ...facets,
      [key]: selected.includes(value) ? selected.filter((other) => other !== value) : [...selected, value],
    });
  };
  const chips: ActiveFilter[] = groups.flatMap((group) => group.selected.map((value) => {
    const option = group.options.find((o) => o.value === value);
    return {
      id: `${group.key}:${value}`,
      label: option && value === '' ? option.label : `${group.title}: ${option ? optionLabel(option) : value}`,
      onRemove: () => toggle(group.key, value),
    };
  }));
  return { groups, chips, toggle };
}

/** The facet groups in the filter menu: pick any number in a group, as the torrent filters do. */
export function LibraryFacetMenuGroups({ groups, onToggle }: {
  groups: FacetGroup[];
  onToggle: (key: LibraryFacetKey, value: string) => void;
}) {
  return groups.map((group) => group.options.length > 0 && (
    <Fragment key={group.key}>
      <ResponsiveMenuSeparator />
      <ResponsiveMenuLabel>{group.title}</ResponsiveMenuLabel>
      {group.options.map((option) => (
        <ResponsiveMenuCheckboxItem
          key={`v:${option.value}`}
          checked={group.selected.includes(option.value)}
          onCheckedChange={() => onToggle(group.key, option.value)}
          ariaLabel={option.hint ? optionLabel(option) : undefined}
        >
          {/* Paths and long tags wrap rather than run off a 320px sheet; the
              instance name stays whole and moves to the next line if it must. */}
          <span className="min-w-0 break-words">
            {option.label}
            {option.hint && (
              <span className="ml-1.5 inline-block max-w-full truncate align-bottom text-xs text-muted-foreground">{option.hint}</span>
            )}
          </span>
        </ResponsiveMenuCheckboxItem>
      ))}
    </Fragment>
  ));
}

/**
 * The saved filters at the top of the filter menu: pick one to apply it (again to
 * clear it), save the current filters, or open the list to rename and delete.
 * Shows only once there is something to pick or save.
 */
export function SavedFiltersMenuSection({ saved, current, onApply, onClear, onOpenDialog }: {
  saved: SavedLibraryFilter[];
  current: LibraryFilterState;
  onApply: (filter: SavedLibraryFilter) => void;
  onClear: () => void;
  onOpenDialog: (dialog: 'save' | 'manage') => void;
}) {
  const canSave = hasLibraryFilterState(current);
  if (saved.length === 0 && !canSave) return null;
  return (
    <>
      <ResponsiveMenuLabel>Saved filters</ResponsiveMenuLabel>
      {saved.map((filter) => {
        const applied = sameLibraryFilterState(current, filter);
        return (
          <ResponsiveMenuCheckboxItem
            key={filter.id}
            checked={applied}
            onCheckedChange={() => (applied ? onClear() : onApply(filter))}
          >
            <span className="min-w-0 break-words">{filter.name}</span>
          </ResponsiveMenuCheckboxItem>
        );
      })}
      {canSave && (
        <ResponsiveMenuActionItem onSelect={() => onOpenDialog('save')}>
          <Bookmark className="h-4 w-4" />
          Save current filters…
        </ResponsiveMenuActionItem>
      )}
      {saved.length > 0 && (
        <ResponsiveMenuActionItem onSelect={() => onOpenDialog('manage')}>
          <Pencil className="h-4 w-4" />
          Rename or delete…
        </ResponsiveMenuActionItem>
      )}
      <ResponsiveMenuSeparator />
    </>
  );
}

/** Change the saved list from its latest value, so a late Undo can't drop a change made since. */
export type UpdateSaved = (update: (list: SavedLibraryFilter[]) => SavedLibraryFilter[]) => void;

/** The Save and Rename-or-delete dialogs the saved-filter rows open. */
export function SavedFilterDialogs({ dialog, onClose, saved, updateSaved, current }: {
  dialog: 'save' | 'manage' | null;
  onClose: () => void;
  saved: SavedLibraryFilter[];
  updateSaved: UpdateSaved;
  current: LibraryFilterState;
}) {
  return (
    <>
      <SaveFilterDialog open={dialog === 'save'} onClose={onClose} saved={saved} updateSaved={updateSaved} current={current} />
      <ManageFiltersDialog open={dialog === 'manage'} onClose={onClose} saved={saved} updateSaved={updateSaved} />
    </>
  );
}

function SaveFilterDialog({ open, onClose, saved, updateSaved, current }: {
  open: boolean;
  onClose: () => void;
  saved: SavedLibraryFilter[];
  updateSaved: UpdateSaved;
  current: LibraryFilterState;
}) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const existing = saved.find((filter) => filter.name.localeCompare(trimmed, undefined, { sensitivity: 'accent' }) === 0);
  const close = () => {
    setName('');
    onClose();
  };
  const submit = () => {
    if (!trimmed) return;
    updateSaved((list) => saveLibraryFilter(list, trimmed, current).list);
    toast.success(existing ? `Updated “${trimmed}”` : `Saved “${trimmed}”`);
    close();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save current filters</DialogTitle>
          <DialogDescription>
            {existing
              ? `Replaces the filters saved as “${existing.name}”.`
              : 'Kept on this device. The search box is not saved.'}
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          aria-label="Filter name"
          placeholder="Name"
          value={name}
          maxLength={SAVED_FILTER_NAME_MAX}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button onClick={submit} disabled={!trimmed}>{existing ? 'Replace' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageFiltersDialog({ open, onClose, saved, updateSaved }: {
  open: boolean;
  onClose: () => void;
  saved: SavedLibraryFilter[];
  updateSaved: UpdateSaved;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const stopEditing = () => {
    setEditingId(null);
    setDraft('');
    setError('');
  };
  const commit = (id: string) => {
    if (!renameSavedLibraryFilter(saved, id, draft)) {
      setError(draft.trim() ? 'Another saved filter has that name.' : 'A name is needed.');
      return;
    }
    updateSaved((list) => renameSavedLibraryFilter(list, id, draft) ?? list);
    stopEditing();
  };
  const remove = (filter: SavedLibraryFilter) => {
    const index = saved.indexOf(filter);
    updateSaved((list) => list.filter((other) => other.id !== filter.id));
    if (editingId === filter.id) stopEditing();
    toast(`Deleted “${filter.name}”`, {
      action: {
        label: 'Undo',
        onClick: () => updateSaved((list) => (list.some((other) => other.id === filter.id)
          ? list
          : [...list.slice(0, index), filter, ...list.slice(index)])),
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { stopEditing(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Saved filters</DialogTitle>
          <DialogDescription>Rename or delete the filters saved on this device.</DialogDescription>
        </DialogHeader>
        {saved.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved filters.</p>
        ) : (
          <ul className="-mx-2 max-h-[50dvh] overflow-y-auto">
            {saved.map((filter) => (
              <li key={filter.id} className="flex min-h-11 items-center gap-1 px-2">
                {editingId === filter.id ? (
                  <div className="flex min-w-0 flex-1 flex-col py-1">
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus
                        aria-label={`New name for ${filter.name}`}
                        value={draft}
                        maxLength={SAVED_FILTER_NAME_MAX}
                        aria-invalid={error ? true : undefined}
                        onChange={(event) => { setDraft(event.target.value); setError(''); }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') { event.preventDefault(); commit(filter.id); }
                          if (event.key === 'Escape') { event.preventDefault(); stopEditing(); }
                        }}
                        className="min-w-0 flex-1"
                      />
                      <Button size="icon" variant="ghost" className="size-11 shrink-0" aria-label="Save name" onClick={() => commit(filter.id)}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="size-11 shrink-0" aria-label="Cancel rename" onClick={stopEditing}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {error && <p role="alert" className="pt-1 text-xs text-destructive">{error}</p>}
                  </div>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 break-words text-sm">{filter.name}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-11 shrink-0"
                      aria-label={`Rename ${filter.name}`}
                      onClick={() => { setEditingId(filter.id); setDraft(filter.name); setError(''); }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-11 shrink-0 text-destructive hover:text-destructive"
                      aria-label={`Delete ${filter.name}`}
                      onClick={() => remove(filter)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button onClick={() => { stopEditing(); onClose(); }}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Everything a library page's filter menu adds for facets and saved filters: the
 * menu's open state (a saved-filter dialog closes the menu before it opens), the
 * facet groups and chips, the saved-filter section, its dialogs, and a reset.
 */
export function useLibraryFilterMenu({
  items, status, setStatus, facets, setFacets, instance, setInstance, watch, setWatch, saved, updateSaved,
}: {
  items: Parameters<typeof libraryFacetOptions>[0];
  status: string[];
  setStatus: (next: string[]) => void;
  facets: LibraryFacetFilters;
  setFacets: (next: LibraryFacetFilters) => void;
  instance: string;
  setInstance: (next: string) => void;
  watch: LibraryFilterState['watch'];
  setWatch?: (next: LibraryFilterState['watch']) => void;
  saved: SavedLibraryFilter[];
  updateSaved: UpdateSaved;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<'save' | 'manage' | null>(null);
  const { groups, chips, toggle } = useLibraryFacetFilters(items, facets, setFacets);
  const current: LibraryFilterState = { status, facets, instance, watch };
  const apply = (filter: LibraryFilterState) => {
    setStatus([...filter.status]);
    setFacets({
      tags: [...filter.facets.tags],
      qualityProfiles: [...filter.facets.qualityProfiles],
      rootFolders: [...filter.facets.rootFolders],
      genres: [...filter.facets.genres],
    });
    setInstance(filter.instance);
    setWatch?.(filter.watch);
  };
  const clearMenuFilters = () => apply({ status: [], facets: { tags: [], qualityProfiles: [], rootFolders: [], genres: [] }, instance: 'all', watch: 'all' });

  const savedSection = (
    <SavedFiltersMenuSection
      saved={saved}
      current={current}
      onApply={apply}
      onClear={clearMenuFilters}
      onOpenDialog={(next) => {
        setMenuOpen(false);
        setDialog(next);
      }}
    />
  );
  const facetGroups = <LibraryFacetMenuGroups groups={groups} onToggle={toggle} />;
  const dialogs = (
    <SavedFilterDialogs dialog={dialog} onClose={() => setDialog(null)} saved={saved} updateSaved={updateSaved} current={current} />
  );
  return { menuOpen, setMenuOpen, savedSection, facetGroups, facetChips: chips, dialogs, clearMenuFilters };
}
