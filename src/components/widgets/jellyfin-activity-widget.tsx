'use client';
import { ApiError } from '@/lib/query-fetch';

import { useState } from 'react';
import type { JellyfinActivityEntry } from '@/types/jellyfin';
import type { WidgetProps } from '@/lib/widgets/types';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { SectionHeader, HPR, ViewModeToggle } from './bento-primitives';
import { useDashboardLayout } from './dashboard-layout-context';
import { ActivityItem, ActivitySeeAllDrawer } from '@/components/jellyfin/activity-item';

const ROW_HEIGHT = 52;
const CAROUSEL_MAX = 20;

function makeFetcher(hasUserId: boolean) {
  return async function fetchActivity(): Promise<JellyfinActivityEntry[]> {
    const res = await fetch(`/api/jellyfin/activity?hasUserId=${hasUserId}&limit=50`);
    if (!res.ok) throw new ApiError(res.status, 'Request failed');
    const data = await res.json();
    return Array.isArray(data.entries) ? data.entries : [];
  };
}

/**
 * Shared read-only feed for Jellyfin's activity log with carousel/list toggle
 * and a "See all" rich-detail drawer. `hasUserId=true` shows user activity
 * ("Activity"); `false` shows system warnings/failed logins ("Alerts"). Both
 * are admin-gated upstream by the route's jellyfin.control capability.
 */
export function JellyfinActivityFeed({
  title,
  hasUserId,
  cacheKey,
  alert = false,
  refreshInterval,
  editMode = false,
  narrow = false,
  layoutVariant,
  instanceId,
  mobileGrid = false,
}: {
  title: string;
  hasUserId: boolean;
  cacheKey: string;
  alert?: boolean;
} & WidgetProps) {
  const { ref, height } = useElementSize<HTMLDivElement>();
  const { visibleCount } = useListFetchSize({ height, rowHeight: ROW_HEIGHT });
  const { setWidgetLayoutOverride } = useDashboardLayout();
  const [seeAll, setSeeAll] = useState(false);
  const { data, loading } = useWidgetData<JellyfinActivityEntry[]>({
    fetchFn: makeFetcher(hasUserId),
    refreshInterval,
    enabled: !editMode,
    cacheKey,
  });
  const list = data ?? [];

  const useList = narrow || layoutVariant === 'list';
  const toggleNode = !narrow && instanceId ? (
    <ViewModeToggle
      value={useList ? 'list' : 'carousel'}
      onChange={(next) => setWidgetLayoutOverride(instanceId, next, { mobile: mobileGrid })}
    />
  ) : null;
  const headerRight = (
    <>
      {toggleNode}
      {list.length > 0 && (
        <button
          type="button"
          onClick={() => { if (!editMode) setSeeAll(true); }}
          style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: editMode ? 'default' : 'pointer', padding: 0 }}
        >
          See all →
        </button>
      )}
    </>
  );

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <SectionHeader title={title} right={headerRight} />
      {loading && list.length === 0 ? (
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
      ) : list.length === 0 ? (
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>Nothing to show</div>
      ) : useList ? (
        <div className="no-scrollbar scroll-fade-y" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {list.slice(0, visibleCount).map((entry, i) => (
            <div key={entry.Id} style={i > 0 ? { borderTop: `1px solid ${HPR.hairline}` } : undefined}>
              <ActivityItem entry={entry} variant="row" alert={alert} />
            </div>
          ))}
        </div>
      ) : (
        <div className="no-scrollbar" style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
          {list.slice(0, CAROUSEL_MAX).map((entry) => (
            <ActivityItem key={entry.Id} entry={entry} variant="card" alert={alert} />
          ))}
        </div>
      )}
      <ActivitySeeAllDrawer open={seeAll} onOpenChange={setSeeAll} title={title} entries={list} alert={alert} />
    </div>
  );
}

export function JellyfinActivityWidget(props: WidgetProps) {
  return <JellyfinActivityFeed title="Activity" hasUserId cacheKey="jellyfin-activity" {...props} />;
}
