'use client';

import { useCallback, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CleanupDashboardTab } from './_components/cleanup-dashboard-tab';
import { QueueCleanerTab } from './_components/queue-cleaner-tab';
import { DownloadCleanerTab } from './_components/download-cleaner-tab';
import { CleanupHistoryTab } from './_components/cleanup-history-tab';

export default function CleanupPage() {
  const [tab, setTab] = useState<'dashboard' | 'queue' | 'download' | 'history'>('dashboard');
  const [dirty, setDirty] = useState<{ queue: boolean; download: boolean }>({ queue: false, download: false });

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
    <div className="px-4 py-6 max-w-5xl mx-auto animate-content-in">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Cleanup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Auto-remove torrents from qBittorrent using rules. Two cleaners:
          Queue Cleaner (active downloads correlated with the Sonarr/Radarr
          queues) and Download Cleaner (seeding policy).
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="w-full mb-4 no-scrollbar overflow-x-auto">
          <TabsTrigger value="dashboard" className="flex-1 min-w-0">Dashboard</TabsTrigger>
          <TabsTrigger value="queue" className="flex-1 min-w-0 relative">
            Queue
            {dirty.queue && (
              <span
                aria-label="Unsaved changes"
                className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500"
              />
            )}
          </TabsTrigger>
          <TabsTrigger value="download" className="flex-1 min-w-0 relative">
            Download
            {dirty.download && (
              <span
                aria-label="Unsaved changes"
                className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500"
              />
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-1 min-w-0">History</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <CleanupDashboardTab onNavigate={(target) => setTab(target)} />
        </TabsContent>
        <TabsContent value="queue">
          <QueueCleanerTab onDirtyChange={onQueueDirty} />
        </TabsContent>
        <TabsContent value="download">
          <DownloadCleanerTab onDirtyChange={onDownloadDirty} />
        </TabsContent>
        <TabsContent value="history">
          <CleanupHistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
