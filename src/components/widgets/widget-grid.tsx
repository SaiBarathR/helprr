'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  TouchSensor,
  MouseSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { useUIStore } from '@/lib/store';
import { getWidgetDefinition } from '@/lib/widgets/registry';
import { SortableWidget } from './sortable-widget';

interface WidgetGridProps {
  refreshInterval: number;
}

export function WidgetGrid({ refreshInterval }: WidgetGridProps) {
  const dashboardLayout = useUIStore((s) => s.dashboardLayout);
  const editMode = useUIStore((s) => s.dashboardEditMode);
  const reorderWidgets = useUIStore((s) => s.reorderWidgets);
  const removeWidget = useUIStore((s) => s.removeWidget);
  const resizeWidget = useUIStore((s) => s.resizeWidget);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setOverId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    setOverId(event.over ? String(event.over.id) : null);
  }

  function handleDragCancel() {
    setActiveId(null);
    setOverId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setActiveId(null);
      setOverId(null);
      return;
    }

    const oldIndex = dashboardLayout.findIndex((w) => w.id === active.id);
    const newIndex = dashboardLayout.findIndex((w) => w.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      setActiveId(null);
      setOverId(null);
      return;
    }

    reorderWidgets(arrayMove(dashboardLayout, oldIndex, newIndex));
    setActiveId(null);
    setOverId(null);
  }

  const itemIds = dashboardLayout.map((w) => w.id);
  const activeWidget = useMemo(
    () => dashboardLayout.find((w) => w.id === activeId),
    [dashboardLayout, activeId]
  );
  const activeWidgetDefinition = activeWidget ? getWidgetDefinition(activeWidget.widgetId) : undefined;

  return (
    <DndContext
      id="widget-grid-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={itemIds} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-3">
          {dashboardLayout.map((instance) => (
            <SortableWidget
              key={instance.id}
              instance={instance}
              refreshInterval={refreshInterval}
              editMode={editMode}
              isDropTarget={editMode && overId === instance.id && activeId !== instance.id}
              onRemove={removeWidget}
              onResize={resizeWidget}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeWidget && (
          <div className={`rounded-xl border border-primary/50 bg-card/95 shadow-2xl backdrop-blur-sm p-3 ${
            activeWidget.size === 'large' || activeWidget.size === 'medium'
              ? 'w-[min(24rem,86vw)]'
              : 'w-[min(12rem,50vw)]'
          }`}>
            <p className="text-sm font-medium">{activeWidgetDefinition?.name || 'Widget'}</p>
            <p className="text-xs text-muted-foreground mt-1">Drop to place</p>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
