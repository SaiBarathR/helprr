'use client';

import { useCallback, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CleanupDashboardTab } from './_components/cleanup-dashboard-tab';
import { QueueCleanerTab } from './_components/queue-cleaner-tab';
import { DownloadCleanerTab } from './_components/download-cleaner-tab';
import { CleanupHistoryTab } from './_components/cleanup-history-tab';
import { useCan } from '@/components/permission-provider';

export default function CleanupPage() {
  const [tab, setTab] = useState<'dashboard' | 'queue' | 'download' | 'history'>('dashboard');
  const [dirty, setDirty] = useState<{ queue: boolean; download: boolean }>({ queue: false, download: false });
  const canManage = useCan('cleanup.manage');
  const activeTab = !canManage && (tab === 'queue' || tab === 'download') ? 'dashboard' : tab;

  // Stable callbacks so the child tabs don't see a new prop identity on every
  // parent render. Without useCallback, the child useEffect that depends on
  // onDirtyChange re-fires every render → re-sets parent state → infinite loop.
  const onQueueDirty = useCallback((d: boolean) => {
    setDirty((prev) => (prev.queue === d ? prev : { ...prev, queue: d }));
  }, []);
  const onDownloadDirty = useCallback((d: boolean) => {
    setDirty((prev) => (prev.download === d ? prev : { ...prev, download: d }));
  }, []);

  return (
    <div className="pb-6 max-w-screen-2xl mx-auto animate-content-in">
      <Tabs value={activeTab} onValueChange={(v) => setTab(v as typeof tab)}>
        <div
          className="page-toolbar page-toolbar-flush mb-4 app-chrome-bar bg-background/95 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        >
          <TabsList className="w-full no-scrollbar overflow-x-auto">
          <TabsTrigger value="dashboard" className="flex-1 min-w-0">Dashboard</TabsTrigger>
          {canManage && (
            <TabsTrigger value="queue" className="flex-1 min-w-0 relative">
              Queue
              {dirty.queue && (
                <span
                  aria-label="Unsaved changes"
                  className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500"
                />
              )}
            </TabsTrigger>
          )}
          {canManage && (
            <TabsTrigger value="download" className="flex-1 min-w-0 relative">
              Download
              {dirty.download && (
                <span
                  aria-label="Unsaved changes"
                  className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500"
                />
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="history" className="flex-1 min-w-0">History</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="dashboard">
          <CleanupDashboardTab onNavigate={(target) => setTab(target)} />
        </TabsContent>
        {canManage && (
          <TabsContent value="queue">
            <QueueCleanerTab onDirtyChange={onQueueDirty} />
          </TabsContent>
        )}
        {canManage && (
          <TabsContent value="download">
            <DownloadCleanerTab onDirtyChange={onDownloadDirty} />
          </TabsContent>
        )}
        <TabsContent value="history">
          <CleanupHistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
