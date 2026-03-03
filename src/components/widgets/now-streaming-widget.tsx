'use client';

import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { Carousel, SectionHeader } from '@/components/widgets/shared';
import { SessionCard } from '@/components/jellyfin/session-card';
import { StreamInfoDrawer } from '@/components/jellyfin/stream-info-drawer';
import type { JellyfinSession } from '@/types/jellyfin';
import type { WidgetProps } from '@/lib/widgets/types';

async function fetchSessions(): Promise<JellyfinSession[]> {
  const res = await fetch('/api/jellyfin/sessions');
  if (!res.ok) return [];
  const data = await res.json();
  return data.sessions || [];
}

export function NowStreamingWidget({ size, refreshInterval }: WidgetProps) {
  const { data: sessions, loading } = useWidgetData({ fetchFn: fetchSessions, refreshInterval });
  const [selectedSession, setSelectedSession] = useState<JellyfinSession | null>(null);

  if (loading) {
    return (
      <div>
        <SectionHeader title="Now Streaming" />
        <div className="flex gap-3 overflow-hidden">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-[100px] w-[200px] rounded-xl shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (!sessions || sessions.length === 0) return null;

  return (
    <div>
      <SectionHeader
        title="Now Streaming"
        badge={
          <span className="flex items-center gap-1.5 text-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span className="text-green-400 tabular-nums">{sessions.length}</span>
          </span>
        }
      />
      <Carousel>
        {sessions.map((session) => (
          <SessionCard key={session.Id} session={session} variant="compact" onInfoClick={setSelectedSession} />
        ))}
      </Carousel>
      <StreamInfoDrawer session={selectedSession} onClose={() => setSelectedSession(null)} />
    </div>
  );
}
