'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MinusCircle } from 'lucide-react';
import { WidgetRenderer } from './widget-renderer';
import type { WidgetInstance, WidgetSize } from '@/lib/widgets/types';
import { getWidgetDefinition } from '@/lib/widgets/registry';

interface SortableWidgetProps {
  instance: WidgetInstance;
  refreshInterval: number;
  editMode: boolean;
  onRemove: (id: string) => void;
  onResize: (id: string, size: WidgetSize) => void;
}

function getNextSize(current: WidgetSize, available: WidgetSize[]): WidgetSize {
  const idx = available.indexOf(current);
  return available[(idx + 1) % available.length];
}

export function SortableWidget({
  instance,
  refreshInterval,
  editMode,
  onRemove,
  onResize,
}: SortableWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: instance.id, disabled: !editMode });

  const definition = getWidgetDefinition(instance.widgetId);
  const isFullWidth = instance.size === 'medium' || instance.size === 'large';

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${isFullWidth ? 'col-span-2' : 'col-span-1'} ${
        isDragging ? 'z-50 opacity-80 scale-[1.02]' : ''
      } ${editMode ? 'widget-jiggle' : ''}`}
      {...(editMode ? { ...attributes, ...listeners } : {})}
    >
      <WidgetRenderer instance={instance} refreshInterval={refreshInterval} />

      {editMode && (
        <>
          {/* Remove button */}
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(instance.id); }}
            className="absolute -top-2 -left-2 z-10 bg-destructive text-white rounded-full p-0.5 shadow-lg active:scale-90 transition-transform"
          >
            <MinusCircle className="h-5 w-5" />
          </button>

          {/* Size toggle pill */}
          {definition && definition.sizes.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onResize(instance.id, getNextSize(instance.size, definition.sizes));
              }}
              className="absolute -bottom-1.5 right-2 z-10 bg-card border border-border rounded-full px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-md active:scale-95 transition-transform"
            >
              {instance.size === 'small' ? 'S' : instance.size === 'medium' ? 'M' : 'L'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
