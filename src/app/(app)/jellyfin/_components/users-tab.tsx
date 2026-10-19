'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import Image from 'next/image';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Badge } from '@/components/ui/badge';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Users } from 'lucide-react';
import type { JellyfinUser, PlaybackUserActivity, CustomHistoryItem } from '@/types/jellyfin';
import { CustomHistoryRow, MAX_DAYS, PluginNotice, ServerErrorState, toDateStr, todayStr } from './shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 2: USERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function UsersTab() {
  const [selectedUser, setSelectedUser] = useState<PlaybackUserActivity | null>(null);

  const playbackQuery = useQuery({
    queryKey: ['jellyfin', 'playback', 'users', MAX_DAYS],
    queryFn: jsonFetcher<{ users?: PlaybackUserActivity[]; pluginAvailable?: boolean }>(
      `/api/jellyfin/playback/users?days=${MAX_DAYS}`
    ),
    staleTime: 60_000,
  });
  const jellyfinUsersQuery = useQuery({
    queryKey: ['jellyfin', 'users'],
    queryFn: jsonFetcher<{ users?: JellyfinUser[] }>('/api/jellyfin/users'),
    select: (d) => d.users ?? [],
    staleTime: 60_000,
  });

  // Per-user "recent plays" drawer — fetched on demand when a user is selected.
  // last-30-days window is computed in the queryFn; cached per user via the key.
  const userHistoryQuery = useQuery({
    queryKey: ['jellyfin', 'playback', 'user-history', selectedUser?.user_id],
    queryFn: jsonFetcher<{ items?: CustomHistoryItem[] }>(
      (() => {
        const to = todayStr();
        const from = new Date();
        from.setDate(from.getDate() - 30);
        return `/api/jellyfin/playback/custom-history?from=${toDateStr(from)}&to=${to}&userId=${selectedUser?.user_id}&limit=30`;
      })()
    ),
    select: (d) => d.items ?? [],
    staleTime: 60_000,
    enabled: !!selectedUser,
  });

  const users = playbackQuery.data?.users ?? [];
  const jellyfinUsers = jellyfinUsersQuery.data ?? [];
  const pluginAvailable = playbackQuery.data?.pluginAvailable !== false;
  const userHistory = userHistoryQuery.data ?? [];
  const historyLoading = userHistoryQuery.isLoading;

  function openUserHistory(user: PlaybackUserActivity) {
    setSelectedUser(user);
  }

  if ((playbackQuery.isLoading && !playbackQuery.data) || (jellyfinUsersQuery.isLoading && !jellyfinUsersQuery.data)) return <PageSpinner />;
  if (playbackQuery.isError && !playbackQuery.data) {
    return <ServerErrorState onRetry={() => void playbackQuery.refetch()} />;
  }
  if (!pluginAvailable) return <PluginNotice />;
  if (users.length === 0) return <div className="text-center py-16 text-muted-foreground"><Users className="h-8 w-8 mx-auto mb-2 opacity-40" /><p className="text-sm">No user activity found</p></div>;

  return (
    <>
      <div className="space-y-2">
        {users.map((user) => {
          const jfUser = jellyfinUsers.find((u) => u.Id === user.user_id);
          const avatarSrc = jfUser?.PrimaryImageTag ? `/api/jellyfin/image?itemId=${user.user_id}&type=Primary&maxWidth=80&quality=80` : null;
          return (
            <button key={user.user_id} onClick={() => openUserHistory(user)} className="w-full text-left rounded-xl bg-muted/30 p-3 active:bg-muted/50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-[var(--hpr-cyan)]/20 flex items-center justify-center shrink-0 overflow-hidden">
                  {avatarSrc ? <Image src={avatarSrc} alt={user.user_name} width={40} height={40} className="object-cover" unoptimized /> : (
                    <span className="text-sm font-bold text-[var(--hpr-cyan)]">{user.user_name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user.user_name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{user.item_name || 'No recent activity'} &middot; {user.client_name}</p>
                </div>
                <div className="text-right shrink-0"><p className="text-xs text-muted-foreground">{user.last_seen}</p></div>
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{user.total_count} plays</Badge>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{user.total_play_time}</Badge>
              </div>
            </button>
          );
        })}
      </div>

      <Drawer open={!!selectedUser} onOpenChange={(open) => { if (!open) setSelectedUser(null); }}>
        <DrawerContent>
          {selectedUser && (
            <>
              <DrawerHeader className="text-left">
                <DrawerTitle className="text-sm">{selectedUser.user_name} — Recent Plays</DrawerTitle>
                <p className="text-xs text-muted-foreground">{selectedUser.total_count} plays all time &middot; {selectedUser.total_play_time}</p>
                <p className="text-xs text-muted-foreground">Showing the latest 30 plays from the last 30 days</p>
              </DrawerHeader>
              <div className="px-2 pb-6 flex-1 min-h-0 overflow-y-auto">
                {historyLoading ? (
                  <PageSpinner />
                ) : userHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No plays in the last 30 days</p>
                ) : (
                  <div className="space-y-1">{userHistory.map((e) => <CustomHistoryRow key={e.RowId} item={e} />)}</div>
                )}
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
