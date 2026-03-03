'use client';

import {
  DndContext,
  closestCenter,
  TouchSensor,
  MouseSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { useUIStore } from '@/lib/store';
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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = dashboardLayout.findIndex((w) => w.id === active.id);
    const newIndex = dashboardLayout.findIndex((w) => w.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    reorderWidgets(arrayMove(dashboardLayout, oldIndex, newIndex));
  }

  const itemIds = dashboardLayout.map((w) => w.id);

  return (
    <DndContext
      id="widget-grid-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
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
              onRemove={removeWidget}
              onResize={resizeWidget}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
