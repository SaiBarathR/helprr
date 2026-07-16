'use client';

import { WidgetGridDesktop } from './widget-grid-desktop';
import { WidgetGridMobile } from './widget-grid-mobile';

interface WidgetGridProps {
  isMobile: boolean;
  onConfigureRefresh: () => void;
}

export function WidgetGrid({ isMobile, onConfigureRefresh }: WidgetGridProps) {
  return isMobile
    ? <WidgetGridMobile onConfigureRefresh={onConfigureRefresh} />
    : <WidgetGridDesktop onConfigureRefresh={onConfigureRefresh} />;
}
