'use client';

import { useState } from 'react';
import { MonitorPlay } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { Carousel, EditModePlaceholder, SectionHeader } from '@/components/widgets/shared';
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

export function NowStreamingWidget({ size, refreshInterval, editMode = false }: WidgetProps) {
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

  if (!sessions || sessions.length === 0) {
    return editMode ? <EditModePlaceholder title="Now Streaming" message="No active streams" /> : null;
  }

  const liveBadge = (
    <span className="flex items-center gap-1.5 text-xs">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
      </span>
      <span className="text-green-400 tabular-nums">{sessions.length}</span>
    </span>
  );

  if (size === 'medium') {
    return (
      <div>
        <SectionHeader title="Now Streaming" badge={liveBadge} />
        <div className="space-y-1.5">
          {sessions.slice(0, 3).map((session) => {
            const np = session.NowPlayingItem;
            const progress = np?.RunTimeTicks && session.PlayState?.PositionTicks
              ? (session.PlayState.PositionTicks / np.RunTimeTicks) * 100
              : 0;
            return (
              <button
                key={session.Id}
                onClick={() => setSelectedSession(session)}
                className="w-full flex items-center gap-2.5 rounded-xl bg-card px-3 py-2.5 hover:bg-muted/30 transition-colors text-left"
              >
                <MonitorPlay className="h-3.5 w-3.5 text-green-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{np?.Name || 'Unknown'}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {session.UserName}{np?.SeriesName ? ` · ${np.SeriesName}` : ''}
                  </p>
                </div>
                {progress > 0 && (
                  <div className="w-10 shrink-0">
                    <div className="h-1 rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-green-400" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <StreamInfoDrawer session={selectedSession} onClose={() => setSelectedSession(null)} />
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="Now Streaming" badge={liveBadge} />
      <Carousel>
        {sessions.map((session) => (
          <SessionCard key={session.Id} session={session} variant="compact" onInfoClick={setSelectedSession} />
        ))}
      </Carousel>
      <StreamInfoDrawer session={selectedSession} onClose={() => setSelectedSession(null)} />
    </div>
  );
}
