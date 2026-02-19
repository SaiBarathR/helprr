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
import { GripVertical, Home, Lock, RotateCcw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/lib/store';
import {
  type NavItemId,
  NAV_ITEM_MAP,
  reconcileNavOrder,
} from '@/lib/nav-config';

function SortableNavItem({
  id,
  isDisabled,
  isPinned,
  isDefault,
  onToggle,
  onSetDefault,
}: {
  id: NavItemId;
  isDisabled: boolean;
  isPinned: boolean;
  isDefault: boolean;
  onToggle: () => void;
  onSetDefault: () => void;
}) {
  const item = NAV_ITEM_MAP[id];
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

  const Icon = item.icon;

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
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-sm font-medium flex-1">{item.label}</span>
      {!isDisabled && !isPinned && (
        <button
          onClick={onSetDefault}
          className="p-1 -m-0.5 rounded-md transition-colors"
          title={isDefault ? 'Default page' : 'Set as default page'}
        >
          <Home
            className={`h-3.5 w-3.5 ${
              isDefault ? 'text-primary' : 'text-muted-foreground/30 hover:text-muted-foreground/60'
            }`}
            strokeWidth={isDefault ? 2.5 : 2}
          />
        </button>
      )}
      {isPinned ? (
        <Lock className="h-3.5 w-3.5 text-muted-foreground/50" />
      ) : (
        <Switch
          checked={!isDisabled}
          onCheckedChange={onToggle}
        />
      )}
    </div>
  );
}

export function NavOrderSettings() {
  const navOrder = useUIStore((s) => s.navOrder);
  const disabledNavItems = useUIStore((s) => s.disabledNavItems);
  const defaultPage = useUIStore((s) => s.defaultPage);
  const setNavOrder = useUIStore((s) => s.setNavOrder);
  const toggleNavItem = useUIStore((s) => s.toggleNavItem);
  const setDefaultPage = useUIStore((s) => s.setDefaultPage);
  const resetNavConfig = useUIStore((s) => s.resetNavConfig);

  const reconciledOrder = useMemo(() => reconcileNavOrder(navOrder), [navOrder]);
  const disabledSet = useMemo(() => new Set(disabledNavItems), [disabledNavItems]);

  // Compute where the divider goes: after the 4th enabled item
  const dividerAfterIndex = useMemo(() => {
    let enabledCount = 0;
    for (let i = 0; i < reconciledOrder.length; i++) {
      if (!disabledSet.has(reconciledOrder[i])) {
        enabledCount++;
        if (enabledCount === 4) return i;
      }
    }
    return -1; // fewer than 5 enabled items, no divider needed
  }, [reconciledOrder, disabledSet]);

  const enabledCount = reconciledOrder.filter((id) => !disabledSet.has(id)).length;

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

    const oldIndex = reconciledOrder.indexOf(active.id as NavItemId);
    const newIndex = reconciledOrder.indexOf(over.id as NavItemId);
    if (oldIndex === -1 || newIndex === -1) return;

    setNavOrder(arrayMove(reconciledOrder, oldIndex, newIndex));
  }

  return (
    <div className="grouped-section px-4 mb-6">
      <div className="grouped-section-title">Navigation</div>
      <div className="grouped-section-content">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={reconciledOrder}
            strategy={verticalListSortingStrategy}
          >
            {reconciledOrder.map((id, index) => {
              const isPinned = !!NAV_ITEM_MAP[id]?.pinned;
              const isDisabled = disabledSet.has(id);
              const showDivider = dividerAfterIndex === index && enabledCount > 4;

              return (
                <div key={id}>
                  <SortableNavItem
                    id={id}
                    isDisabled={isDisabled}
                    isPinned={isPinned}
                    isDefault={defaultPage === id}
                    onToggle={() => toggleNavItem(id)}
                    onSetDefault={() => setDefaultPage(id)}
                  />
                  {showDivider && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-background/50">
                      <div className="flex-1 border-t border-dashed border-muted-foreground/20" />
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">
                        More menu
                      </span>
                      <div className="flex-1 border-t border-dashed border-muted-foreground/20" />
                    </div>
                  )}
                </div>
              );
            })}
          </SortableContext>
        </DndContext>
      </div>
      <div className="mt-2 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground h-8"
          onClick={resetNavConfig}
        >
          <RotateCcw className="h-3 w-3 mr-1.5" />
          Reset to Default
        </Button>
      </div>
    </div>
  );
}
