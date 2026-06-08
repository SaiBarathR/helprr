'use client';

import type { WidgetProps } from '@/lib/widgets/types';
import { JellyfinActivityFeed } from './jellyfin-activity-widget';

export function JellyfinAlertsWidget(props: WidgetProps) {
  return (
    <JellyfinActivityFeed
      title="Alerts"
      hasUserId={false}
      cacheKey="jellyfin-alerts"
      alert
      {...props}
    />
  );
}
