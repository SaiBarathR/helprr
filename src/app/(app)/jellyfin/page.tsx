'use client';

import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCan } from '@/components/permission-provider';
import { HistoryTab } from './_components/history-tab';
import { OverviewTab } from './_components/overview-tab';
import { StatsTab } from './_components/stats-tab';
import { UsersTab } from './_components/users-tab';

// ─── Types ───

type TabKey = 'overview' | 'users' | 'history' | 'stats';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'history', label: 'History' },
  { key: 'stats', label: 'Stats' },
];

// ─── Main Page ───

export default function JellyfinPage() {
  const pageQueryClient = useQueryClient();
  const [tab, setTab] = useRouteViewState<TabKey>('JellyfinPage:tab', 'overview');
  // Users (sessions) and Stats are admin analytics; members keep Overview and
  // their own per-user History.
  const canSessions = useCan('jellyfin.sessions');
  const canStats = useCan('jellyfin.stats');
  const visibleTabs = useMemo(
    () =>
      TABS.filter((t) => {
        if (t.key === 'users') return canSessions;
        if (t.key === 'stats') return canStats;
        return true;
      }),
    [canSessions, canStats]
  );

  return (
    <div className="flex flex-col min-h-0 animate-content-in">
      <h1 className="sr-only">Jellyfin</h1>
      <PullToRefresh onRefresh={() => pageQueryClient.invalidateQueries({ queryKey: ['jellyfin'] })} />
      {/* Radix Tabs: same segmented look, plus roving focus + arrow-key nav. */}
      <Tabs
        value={visibleTabs.some((item) => item.key === tab) ? tab : 'overview'}
        onValueChange={(v) => setTab(v as TabKey)}
        className="flex flex-1 min-h-0 flex-col gap-0"
      >
        <div className="page-toolbar page-toolbar-flush pb-3 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <TabsList aria-label="Jellyfin sections" className="flex w-full h-auto bg-muted/50 p-0.5 gap-0.5">
            {visibleTabs.map((t) => (
              <TabsTrigger
                key={t.key}
                value={t.key}
                className="flex-1 text-xs font-medium py-1.5 px-2 data-[state=active]:shadow-sm"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="page-bleed flex-1 overflow-y-auto pt-3 pb-4">
          <TabsContent value="overview"><OverviewTab /></TabsContent>
          {canSessions && <TabsContent value="users"><UsersTab /></TabsContent>}
          <TabsContent value="history"><HistoryTab /></TabsContent>
          {canStats && <TabsContent value="stats"><StatsTab /></TabsContent>}
        </div>
      </Tabs>
    </div>
  );
}
