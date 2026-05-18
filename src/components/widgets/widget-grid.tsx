'use client';

import { WidgetGridDesktop } from './widget-grid-desktop';
import { WidgetGridMobile } from './widget-grid-mobile';

interface WidgetGridProps {
  isMobile: boolean;
}

export function WidgetGrid({ isMobile }: WidgetGridProps) {
  return isMobile ? <WidgetGridMobile /> : <WidgetGridDesktop />;
}
