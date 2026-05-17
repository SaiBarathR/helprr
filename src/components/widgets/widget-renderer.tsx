'use client';

import { Suspense } from 'react';
import { getWidgetDefinition } from '@/lib/widgets/registry';
import { WidgetWrapper, WidgetSkeleton } from './widget-wrapper';
import { useUIStore } from '@/lib/store';
import type { WidgetInstance, WidgetLayoutVariant, WidgetProps } from '@/lib/widgets/types';
import { HPR } from './bento-primitives';

interface WidgetRendererProps {
  instance: WidgetInstance;
  refreshInterval: number;
  editMode?: boolean;
  narrow?: boolean;
  colSpan?: number;
  rowSpan?: number;
  layoutVariant?: WidgetLayoutVariant;
}

export function WidgetRenderer({
  instance,
  refreshInterval,
  editMode = false,
  narrow,
  colSpan,
  rowSpan,
  layoutVariant,
}: WidgetRendererProps) {
  const discoverLayout = useUIStore((s) => s.discoverLayout);
  const definition = getWidgetDefinition(instance.widgetId, discoverLayout);

  if (!definition) {
    return (
      <div
        style={{
          fontSize: 11,
          color: HPR.fgSubtle,
          padding: 12,
        }}
      >
        Unknown widget: {instance.widgetId}
      </div>
    );
  }

  const WidgetComponent = definition.component;
  const widgetProps: WidgetProps = {
    refreshInterval,
    editMode,
    narrow,
    colSpan,
    rowSpan,
    layoutVariant,
    instanceId: instance.id,
  };

  return (
    <WidgetWrapper widgetId={instance.id}>
      <Suspense fallback={<WidgetSkeleton rowSpan={rowSpan} />}>
        <WidgetComponent {...widgetProps} />
      </Suspense>
    </WidgetWrapper>
  );
}
