'use client';

import { Suspense } from 'react';
import { getWidgetDefinition } from '@/lib/widgets/registry';
import { WidgetWrapper, WidgetSkeleton } from './widget-wrapper';
import type { WidgetInstance } from '@/lib/widgets/types';

interface WidgetRendererProps {
  instance: WidgetInstance;
  refreshInterval: number;
  editMode?: boolean;
}

export function WidgetRenderer({ instance, refreshInterval, editMode = false }: WidgetRendererProps) {
  const definition = getWidgetDefinition(instance.widgetId);

  if (!definition) {
    return (
      <div className="rounded-xl bg-card p-4 text-xs text-muted-foreground">
        Unknown widget: {instance.widgetId}
      </div>
    );
  }

  const WidgetComponent = definition.component;

  return (
    <WidgetWrapper widgetId={instance.id}>
      <Suspense fallback={<WidgetSkeleton size={instance.size} />}>
        <WidgetComponent size={instance.size} refreshInterval={refreshInterval} editMode={editMode} />
      </Suspense>
    </WidgetWrapper>
  );
}
