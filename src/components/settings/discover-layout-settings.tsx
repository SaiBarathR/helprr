'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  TouchSensor,
  MouseSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  RotateCcw,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Save,
  Sparkles,
  X,
  Check,
  ChevronRight,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { LanguageRegionCombobox } from '@/components/ui/language-region-combobox';
import { toast } from 'sonner';
import {
  type DiscoverLayoutSection,
  type DiscoverLayoutConfig,
  type DiscoverLayoutCustomFilters,
  DEFAULT_DISCOVER_LAYOUT,
  buildDefaultCustomFilters,
} from '@/lib/discover-layout-config';
import type { DiscoverFiltersResponse } from '@/types';
import { useUIStore } from '@/lib/store';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SORT_OPTIONS = [
  { value: 'trending', label: 'Trending' },
  { value: 'highlyRated', label: 'Highly Rated' },
  { value: 'mostLoved', label: 'Most Loved' },
  { value: 'popular', label: 'Popular' },
  { value: 'upcoming', label: 'Upcoming' },
] as const;

const CONTENT_TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'show', label: 'Shows' },
] as const;

const RELEASE_STATE_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'released', label: 'Released' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'airing', label: 'Airing' },
  { value: 'ended', label: 'Ended' },
] as const;

// ---------------------------------------------------------------------------
// Sortable item
// ---------------------------------------------------------------------------

function SortableSection({
  section,
  onToggle,
  onEdit,
  onDelete,
}: {
  section: DiscoverLayoutSection;
  onToggle: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-3 py-2.5 min-h-[44px] border-b border-[oklch(1_0_0/6%)] last:border-b-0 ${
        isDragging ? 'z-50 bg-card shadow-lg rounded-lg opacity-90' : ''
      } ${!section.enabled ? 'opacity-40' : ''}`}
    >
      <button
        className="touch-none p-1 -m-1 text-muted-foreground/50 cursor-grab active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium block truncate">{section.label}</span>
        {section.type === 'custom' && (
          <span className="text-[10px] text-muted-foreground/60">Custom carousel</span>
        )}
      </div>

      {section.type === 'custom' && onEdit && (
        <button
          onClick={onEdit}
          className="p-1 text-muted-foreground/60 hover:text-foreground"
          aria-label="Edit custom carousel"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}

      {section.type === 'custom' && onDelete && (
        <button
          onClick={onDelete}
          className="p-1 text-muted-foreground/60 hover:text-red-400"
          aria-label="Delete custom carousel"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      <Switch checked={section.enabled} onCheckedChange={onToggle} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom carousel editor sheet
// ---------------------------------------------------------------------------

function CustomCarouselEditor({
  open,
  onOpenChange,
  onSave,
  initial,
  filtersMeta,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (label: string, filters: DiscoverLayoutCustomFilters) => void;
  initial?: { label: string; filters: DiscoverLayoutCustomFilters };
  filtersMeta: DiscoverFiltersResponse | null;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [filters, setFilters] = useState<DiscoverLayoutCustomFilters>(
    initial?.filters ?? buildDefaultCustomFilters()
  );

  useEffect(() => {
    if (open) {
      setLabel(initial?.label ?? '');
      setFilters(initial?.filters ?? buildDefaultCustomFilters());
    }
  }, [open, initial]);

  const genreChoices = useMemo(() => {
    if (!filtersMeta) return [];
    if (filters.contentType === 'movie') return filtersMeta.genres.filter((g) => g.type === 'movie');
    if (filters.contentType === 'show') return filtersMeta.genres.filter((g) => g.type === 'tv');
    return filtersMeta.genres;
  }, [filtersMeta, filters.contentType]);

  const providerChoices = useMemo(() => {
    if (!filtersMeta) return [];
    if (filters.contentType === 'movie') return filtersMeta.providers.filter((p) => p.type === 'movie');
    if (filters.contentType === 'show') return filtersMeta.providers.filter((p) => p.type === 'tv');
    return filtersMeta.providers;
  }, [filtersMeta, filters.contentType]);

  const handleSave = () => {
    const trimmed = label.trim();
    if (!trimmed) {
      toast.error('Please enter a name for the carousel');
      return;
    }
    onSave(trimmed, filters);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[92vw] sm:max-w-md p-0">
        <SheetHeader>
          <SheetTitle>{initial ? 'Edit Custom Carousel' : 'New Custom Carousel'}</SheetTitle>
        </SheetHeader>

        <div className="px-4 pb-4 overflow-y-auto space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Carousel Name</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Horror Movies 2020s"
            />
          </div>

          {/* Content Type */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Content Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {CONTENT_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFilters({ ...filters, contentType: opt.value })}
                  className={`px-3 py-2 rounded-lg border text-sm ${
                    filters.contentType === opt.value
                      ? 'border-primary text-primary'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sort */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Sort</Label>
            <div className="grid grid-cols-2 gap-2">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFilters({ ...filters, sortBy: opt.value })}
                  className={`px-3 py-2 rounded-lg border text-sm ${
                    filters.sortBy === opt.value
                      ? 'border-primary text-primary'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sort Direction */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Sort Direction</Label>
            <div className="grid grid-cols-2 gap-2">
              {(['desc', 'asc'] as const).map((dir) => (
                <button
                  key={dir}
                  onClick={() => setFilters({ ...filters, sortOrder: dir })}
                  className={`px-3 py-2 rounded-lg border text-sm uppercase ${
                    filters.sortOrder === dir
                      ? 'border-primary text-primary'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {dir}
                </button>
              ))}
            </div>
          </div>

          {/* Year Range */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Year From</Label>
              <Input
                value={filters.yearFrom ?? ''}
                onChange={(e) => setFilters({ ...filters, yearFrom: e.target.value })}
                placeholder="1995"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Year To</Label>
              <Input
                value={filters.yearTo ?? ''}
                onChange={(e) => setFilters({ ...filters, yearTo: e.target.value })}
                placeholder="2026"
                inputMode="numeric"
              />
            </div>
          </div>

          {/* Runtime Range */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Runtime Min</Label>
              <Input
                value={filters.runtimeMin ?? ''}
                onChange={(e) => setFilters({ ...filters, runtimeMin: e.target.value })}
                placeholder="45"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Runtime Max</Label>
              <Input
                value={filters.runtimeMax ?? ''}
                onChange={(e) => setFilters({ ...filters, runtimeMax: e.target.value })}
                placeholder="180"
                inputMode="numeric"
              />
            </div>
          </div>

          {/* Rating Range */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Rating Min</Label>
              <Input
                value={filters.ratingMin ?? ''}
                onChange={(e) => setFilters({ ...filters, ratingMin: e.target.value })}
                placeholder="7.5"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Rating Max</Label>
              <Input
                value={filters.ratingMax ?? ''}
                onChange={(e) => setFilters({ ...filters, ratingMax: e.target.value })}
                placeholder="10"
                inputMode="decimal"
              />
            </div>
          </div>

          {/* Vote Count Min */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Vote Count Min</Label>
            <Input
              value={filters.voteCountMin ?? ''}
              onChange={(e) => setFilters({ ...filters, voteCountMin: e.target.value })}
              placeholder="500"
              inputMode="numeric"
            />
          </div>

          {/* Language & Region */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5 flex flex-col">
              <Label className="text-xs text-muted-foreground">Language</Label>
              <LanguageRegionCombobox
                value={filters.language ?? ''}
                onChange={(code) => setFilters({ ...filters, language: code })}
                options={filtersMeta?.languages || []}
                placeholder="Any language"
                emptyLabel="Any language"
                searchPlaceholder="Search language"
              />
            </div>
            <div className="space-y-1.5 flex flex-col">
              <Label className="text-xs text-muted-foreground">Region</Label>
              <LanguageRegionCombobox
                value={filters.region ?? ''}
                onChange={(code) => setFilters({ ...filters, region: code })}
                options={filtersMeta?.regions || []}
                placeholder="Any region"
                emptyLabel="Any region"
                searchPlaceholder="Search region"
              />
            </div>
          </div>

          {/* Release State */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Release State</Label>
            <div className="grid grid-cols-3 gap-2">
              {RELEASE_STATE_OPTIONS.map((opt) => (
                <button
                  key={opt.value || 'any'}
                  onClick={() => setFilters({ ...filters, releaseState: opt.value })}
                  className={`px-3 py-2 rounded-lg border text-sm ${
                    (filters.releaseState ?? '') === opt.value
                      ? 'border-primary text-primary'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Genres */}
          {genreChoices.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Genres</Label>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border/50 p-2">
                <div className="flex flex-wrap gap-2">
                  {genreChoices.slice(0, 28).map((genre) => {
                    const active = filters.genres?.includes(genre.id) ?? false;
                    return (
                      <button
                        key={`${genre.type}-${genre.id}`}
                        onClick={() => {
                          const set = new Set(filters.genres ?? []);
                          if (set.has(genre.id)) set.delete(genre.id);
                          else set.add(genre.id);
                          setFilters({ ...filters, genres: [...set] });
                        }}
                        className={`px-2.5 py-1 rounded-full text-xs border whitespace-normal text-left leading-tight ${
                          active ? 'border-primary text-primary' : 'border-border text-muted-foreground'
                        }`}
                      >
                        {genre.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Providers */}
          {providerChoices.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Providers</Label>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border/50 p-2">
                <div className="flex flex-wrap gap-2">
                  {providerChoices.slice(0, 28).map((provider) => {
                    const active = filters.providers?.includes(provider.id) ?? false;
                    return (
                      <button
                        key={`${provider.type}-${provider.id}`}
                        onClick={() => {
                          const set = new Set(filters.providers ?? []);
                          if (set.has(provider.id)) set.delete(provider.id);
                          else set.add(provider.id);
                          setFilters({ ...filters, providers: [...set] });
                        }}
                        className={`px-2.5 py-1 rounded-full text-xs border whitespace-normal text-left leading-tight ${
                          active ? 'border-primary text-primary' : 'border-border text-muted-foreground'
                        }`}
                      >
                        {provider.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Networks */}
          {(filtersMeta?.networks?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Networks</Label>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border/50 p-2">
                <div className="flex flex-wrap gap-2">
                  {(filtersMeta?.networks ?? []).slice(0, 24).map((network) => {
                    const active = filters.networks?.includes(network.id) ?? false;
                    return (
                      <button
                        key={network.id}
                        onClick={() => {
                          const set = new Set(filters.networks ?? []);
                          if (set.has(network.id)) set.delete(network.id);
                          else set.add(network.id);
                          setFilters({ ...filters, networks: [...set] });
                        }}
                        className={`px-2.5 py-1 rounded-full text-xs border whitespace-normal text-left leading-tight ${
                          active ? 'border-primary text-primary' : 'border-border text-muted-foreground'
                        }`}
                      >
                        {network.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="border-t">
          <div className="grid grid-cols-2 gap-2 w-full">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              <Check className="h-3.5 w-3.5 mr-1.5" />
              {initial ? 'Update' : 'Create'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Main settings component
// ---------------------------------------------------------------------------

export function DiscoverLayoutSettings() {
  const [layout, setLayout] = useState<DiscoverLayoutConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Custom carousel editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Filters metadata for genre/provider pickers
  const [filtersMeta, setFiltersMeta] = useState<DiscoverFiltersResponse | null>(null);

  // Load current layout
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [layoutRes, filtersRes] = await Promise.allSettled([
          fetch('/api/settings/discover-layout'),
          fetch('/api/discover/filters'),
        ]);

        if (layoutRes.status === 'fulfilled' && layoutRes.value.ok) {
          const data = await layoutRes.value.json();
          setLayout(data);
        }

        if (filtersRes.status === 'fulfilled' && filtersRes.value.ok) {
          const data = await filtersRes.value.json();
          setFiltersMeta(data);
        }
      } catch {
        // noop
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const sections = useMemo(() => layout?.sections ?? [], [layout]);
  const sectionIds = useMemo(() => sections.map((s) => s.id), [sections]);

  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(MouseSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const updateLayout = useCallback(
    (updater: (prev: DiscoverLayoutConfig) => DiscoverLayoutConfig) => {
      setLayout((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        setDirty(true);
        return next;
      });
    },
    []
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      updateLayout((prev) => {
        const oldIndex = prev.sections.findIndex((s) => s.id === active.id);
        const newIndex = prev.sections.findIndex((s) => s.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return prev;
        return { sections: arrayMove(prev.sections, oldIndex, newIndex) };
      });
    },
    [updateLayout]
  );

  const handleToggle = useCallback(
    (id: string) => {
      updateLayout((prev) => ({
        sections: prev.sections.map((s) =>
          s.id === id ? { ...s, enabled: !s.enabled } : s
        ),
      }));
    },
    [updateLayout]
  );

  const handleDeleteCustom = useCallback(
    (id: string) => {
      updateLayout((prev) => ({
        sections: prev.sections.filter((s) => s.id !== id),
      }));
    },
    [updateLayout]
  );

  const handleEditCustom = useCallback((id: string) => {
    setEditingId(id);
    setEditorOpen(true);
  }, []);

  const handleAddCustom = useCallback(() => {
    setEditingId(null);
    setEditorOpen(true);
  }, []);

  const handleEditorSave = useCallback(
    (label: string, filters: DiscoverLayoutCustomFilters) => {
      if (editingId) {
        // Update existing
        updateLayout((prev) => ({
          sections: prev.sections.map((s) =>
            s.id === editingId ? { ...s, label, filters } : s
          ),
        }));
      } else {
        // Create new
        const newSection: DiscoverLayoutSection = {
          id: `custom_${Date.now()}`,
          type: 'custom',
          label,
          enabled: true,
          filters,
        };
        updateLayout((prev) => ({
          sections: [...prev.sections, newSection],
        }));
      }
    },
    [editingId, updateLayout]
  );

  const handleSave = useCallback(async () => {
    if (!layout) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/discover-layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(layout),
      });
      if (res.ok) {
        const saved = await res.json();
        setLayout(saved);
        useUIStore.getState().setDiscoverLayout(saved);
        setDirty(false);
        toast.success('Discover layout saved');
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? 'Failed to save layout');
      }
    } catch {
      toast.error('Failed to save layout');
    } finally {
      setSaving(false);
    }
  }, [layout]);

  const handleReset = useCallback(async () => {
    const defaultLayout = {
      sections: DEFAULT_DISCOVER_LAYOUT.sections.map((s) => ({ ...s })),
    };
    setSaving(true);
    try {
      const res = await fetch('/api/settings/discover-layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(defaultLayout),
      });
      if (res.ok) {
        const saved = await res.json();
        setLayout(saved);
        useUIStore.getState().setDiscoverLayout(saved);
        setDirty(false);
        toast.success('Discover layout reset to default');
      } else {
        toast.error('Failed to reset layout');
      }
    } catch {
      toast.error('Failed to reset layout');
    } finally {
      setSaving(false);
    }
  }, []);

  const editingSection = editingId
    ? sections.find((s) => s.id === editingId)
    : undefined;

  if (loading) {
    return (
      <div className="grouped-section mb-6">
        <div className="grouped-section-title">Discover Layout</div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grouped-section mb-6">
        <div className="grouped-section-title">Discover Layout</div>
        <p className="text-xs text-muted-foreground px-4 pb-2">
          Drag to reorder, toggle visibility, and add custom carousels.
          Settings are synced across all devices.
        </p>

        <div className="grouped-section-content">
          <DndContext
            id="discover-layout-settings-dnd"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sectionIds}
              strategy={verticalListSortingStrategy}
            >
              {sections.map((section) => (
                <SortableSection
                  key={section.id}
                  section={section}
                  onToggle={() => handleToggle(section.id)}
                  onEdit={
                    section.type === 'custom'
                      ? () => handleEditCustom(section.id)
                      : undefined
                  }
                  onDelete={
                    section.type === 'custom'
                      ? () => handleDeleteCustom(section.id)
                      : undefined
                  }
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {/* Actions */}
        <div className="mt-2 flex items-center justify-between px-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-8 gap-1.5"
            onClick={handleAddCustom}
          >
            <Plus className="h-3 w-3" />
            Add Custom Carousel
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground h-8"
              onClick={handleReset}
              disabled={saving}
            >
              <RotateCcw className="h-3 w-3 mr-1.5" />
              Reset
            </Button>

            <Button
              size="sm"
              className="text-xs h-8 gap-1.5"
              onClick={handleSave}
              disabled={!dirty || saving}
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save
            </Button>
          </div>
        </div>
      </div>

      <CustomCarouselEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSave={handleEditorSave}
        initial={
          editingSection?.type === 'custom' && editingSection.filters
            ? { label: editingSection.label, filters: editingSection.filters }
            : undefined
        }
        filtersMeta={filtersMeta}
      />
    </>
  );
}
