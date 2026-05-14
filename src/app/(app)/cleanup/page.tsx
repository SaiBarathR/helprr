'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CleanupDashboardTab } from './_components/cleanup-dashboard-tab';
import { QueueCleanerTab } from './_components/queue-cleaner-tab';
import { DownloadCleanerTab } from './_components/download-cleaner-tab';
import { CleanupHistoryTab } from './_components/cleanup-history-tab';

export default function CleanupPage() {
  const [tab, setTab] = useState<'dashboard' | 'queue' | 'download' | 'history'>('dashboard');

  return (
    <div className="px-4 py-6 max-w-5xl mx-auto animate-content-in">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Cleanup</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Auto-remove torrents from qBittorrent using rules. Two cleaners: Queue Cleaner (active downloads via Sonarr/Radarr queue) and Download Cleaner (seeding policy).
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="w-full grid grid-cols-4 mb-4">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="download">Download</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <CleanupDashboardTab onNavigate={(target) => setTab(target)} />
        </TabsContent>
        <TabsContent value="queue">
          <QueueCleanerTab />
        </TabsContent>
        <TabsContent value="download">
          <DownloadCleanerTab />
        </TabsContent>
        <TabsContent value="history">
          <CleanupHistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
