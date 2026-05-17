'use client';

import { WidgetGridDesktop } from './widget-grid-desktop';
import { WidgetGridMobile } from './widget-grid-mobile';

interface WidgetGridProps {
  refreshInterval: number;
  isMobile: boolean;
}

export function WidgetGrid({ refreshInterval, isMobile }: WidgetGridProps) {
  return isMobile
    ? <WidgetGridMobile refreshInterval={refreshInterval} />
    : <WidgetGridDesktop refreshInterval={refreshInterval} />;
}
