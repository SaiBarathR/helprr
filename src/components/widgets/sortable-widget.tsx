'use client';

import { useSortable, defaultAnimateLayoutChanges } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, MinusCircle } from 'lucide-react';
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
  } = useSortable({
    id: instance.id,
    disabled: !editMode,
    animateLayoutChanges: (args) => defaultAnimateLayoutChanges({ ...args, wasDragging: true }),
  });

  const definition = getWidgetDefinition(instance.widgetId);
  const isFullWidth = instance.size === 'medium' || instance.size === 'large';
  const widgetTitle = definition?.name || 'widget';

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition || 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)',
  };

  return (
    <div
      id={`widget-${instance.id}`}
      ref={setNodeRef}
      style={style}
      className={`relative ${isFullWidth ? 'col-span-2' : 'col-span-1'} ${isDragging ? 'z-0 widget-ghost rounded-2xl' : ''
        }`}
      onContextMenu={editMode ? (e) => e.preventDefault() : undefined}
      {...(editMode ? { ...attributes } : {})}
    >
      <div className={`${editMode && !isDragging ? 'widget-jiggle' : ''} ${isDragging ? 'invisible' : ''
        } ${editMode ? 'pointer-events-none select-none touch-none' : ''}`}>
        <WidgetRenderer instance={instance} refreshInterval={refreshInterval} editMode={editMode} />
      </div>

      {editMode && !isDragging && (
        <>
          {/* Drag handle */}
          <button
            type="button"
            aria-label={`Drag ${widgetTitle}`}
            {...listeners}
            className="absolute -top-2 left-1/2 z-10 -translate-x-1/2 bg-card border border-border text-muted-foreground rounded-full p-1 shadow-lg cursor-grab active:cursor-grabbing active:scale-90 transition-transform"
          >
            <GripVertical className="h-4 w-4" />
          </button>

          {/* Remove button */}
          <button
            type="button"
            aria-label={`Remove ${widgetTitle}`}
            onClick={(e) => { e.stopPropagation(); onRemove(instance.id); }}
            className="absolute -top-2 -left-2 z-10 bg-destructive text-white rounded-full p-0.5 shadow-lg active:scale-90 transition-transform"
          >
            <MinusCircle className="h-5 w-5" />
          </button>

          {/* Size toggle pill */}
          {definition && definition.sizes.length > 1 && (
            <button
              type="button"
              aria-label={`Resize ${widgetTitle} to ${getNextSize(instance.size, definition.sizes)}`}
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
