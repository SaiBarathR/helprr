'use client';

import { useMemo } from 'react';
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
import { GripVertical, RotateCcw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/lib/store';
import {
  type AnimeCarouselId,
  ANIME_CAROUSEL_MAP,
  reconcileAnimeCarouselOrder,
} from '@/lib/anime-carousel-config';

function SortableCarouselItem({
  id,
  isDisabled,
  onToggle,
}: {
  id: AnimeCarouselId;
  isDisabled: boolean;
  onToggle: () => void;
}) {
  const item = ANIME_CAROUSEL_MAP[id];
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

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
      } ${isDisabled ? 'opacity-40' : ''}`}
    >
      <button
        className="touch-none p-1 -m-1 text-muted-foreground/50 cursor-grab active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="text-sm font-medium flex-1">{item.label}</span>
      {item.requiresAniList && (
        <span className="text-[10px] text-muted-foreground/60 bg-muted/60 px-1.5 py-0.5 rounded">
          AniList
        </span>
      )}
      <Switch checked={!isDisabled} onCheckedChange={onToggle} />
    </div>
  );
}

/**
 * Settings section for reordering and toggling anime home page carousels.
 * Uses drag-and-drop (same pattern as NavOrderSettings) and persists via Zustand localStorage.
 */
export function AnimeCarouselSettings() {
  const animeCarouselOrder = useUIStore((s) => s.animeCarouselOrder);
  const disabledAnimeCarousels = useUIStore((s) => s.disabledAnimeCarousels);
  const setAnimeCarouselOrder = useUIStore((s) => s.setAnimeCarouselOrder);
  const toggleAnimeCarousel = useUIStore((s) => s.toggleAnimeCarousel);
  const resetAnimeCarouselConfig = useUIStore((s) => s.resetAnimeCarouselConfig);

  const reconciledOrder = useMemo(
    () => reconcileAnimeCarouselOrder(animeCarouselOrder),
    [animeCarouselOrder]
  );
  const disabledSet = useMemo(
    () => new Set(disabledAnimeCarousels),
    [disabledAnimeCarousels]
  );

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = reconciledOrder.indexOf(active.id as AnimeCarouselId);
    const newIndex = reconciledOrder.indexOf(over.id as AnimeCarouselId);
    if (oldIndex === -1 || newIndex === -1) return;

    setAnimeCarouselOrder(arrayMove(reconciledOrder, oldIndex, newIndex));
  }

  return (
    <div className="grouped-section px-4 mb-6">
      <div className="grouped-section-title">Anime Carousels</div>
      <p className="text-xs text-muted-foreground px-4 pb-2">
        Drag to reorder and toggle carousels on the Anime home page. Settings are saved per device.
      </p>
      <div className="grouped-section-content">
        <DndContext
          id="anime-carousel-settings-dnd"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={reconciledOrder}
            strategy={verticalListSortingStrategy}
          >
            {reconciledOrder.map((id) => (
              <SortableCarouselItem
                key={id}
                id={id}
                isDisabled={disabledSet.has(id)}
                onToggle={() => toggleAnimeCarousel(id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
      <div className="mt-2 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground h-8"
          onClick={resetAnimeCarouselConfig}
        >
          <RotateCcw className="h-3 w-3 mr-1.5" />
          Reset to Default
        </Button>
      </div>
    </div>
  );
}
