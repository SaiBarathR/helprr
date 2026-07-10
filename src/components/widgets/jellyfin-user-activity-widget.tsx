'use client';

import { useCallback, useRef, useState } from 'react';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import type { PlaybackUserActivity, JellyfinUser, CustomHistoryItem } from '@/types/jellyfin';
import type { WidgetProps } from '@/lib/widgets/types';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useWidgetFilter } from './use-widget-filter';
import { DaysPill, JELLYFIN_DAYS_OPTIONS, MAX_DAYS } from './widget-filter-controls';
import { SectionHeader, HPR } from './bento-primitives';
import { formatDurationSeconds } from '@/lib/jellyfin-helpers';

interface Filters {
  days: number;
}

const DEFAULTS: Filters = { days: 0 }; // 0 = all time (MAX_DAYS)

interface UserActivityData {
  users: PlaybackUserActivity[];
  jellyfinUsers: JellyfinUser[];
  pluginAvailable: boolean;
}

async function fetchUserActivity(days: number): Promise<UserActivityData> {
  const queryDays = days === 0 ? MAX_DAYS : days;
  const [pbRes, jfRes] = await Promise.allSettled([
    fetch(`/api/jellyfin/playback/users?days=${queryDays}`),
    fetch('/api/jellyfin/users'),
  ]);
  let users: PlaybackUserActivity[] = [];
  let jellyfinUsers: JellyfinUser[] = [];
  let pluginAvailable = true;
  if (pbRes.status === 'fulfilled' && pbRes.value.ok) {
    const d = await pbRes.value.json();
    users = d.users ?? [];
    if (d.pluginAvailable === false) pluginAvailable = false;
  }
  if (jfRes.status === 'fulfilled' && jfRes.value.ok) {
    const d = await jfRes.value.json();
    jellyfinUsers = d.users ?? [];
  }
  return { users, jellyfinUsers, pluginAvailable };
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateCreated(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

// The Playback Reporting plugin returns verbose durations ("2 weeks 1 day
// 17 hours 35 minutes", "3 days ago"). Compact cells swap them for short
// forms ("2w 1d", "3d") so the numbers stay fully readable.
function shortPluginDuration(text: string, maxParts = 2): string {
  const UNITS: Record<string, string> = {
    year: 'y', month: 'mo', week: 'w', day: 'd', hour: 'h', minute: 'm', second: 's',
  };
  const parts: string[] = [];
  for (const m of text.matchAll(/(\d+)\s*([a-zA-Z]+)/g)) {
    const unit = UNITS[m[2].toLowerCase().replace(/s$/, '')];
    if (unit) parts.push(`${m[1]}${unit}`);
    if (parts.length >= maxParts) break;
  }
  return parts.length > 0 ? parts.join(' ') : text;
}

export function JellyfinUserActivityWidget({ refreshInterval, editMode = false, narrow = false }: WidgetProps) {
  const [filters, setFilters] = useWidgetFilter<Filters>('jellyfin-user-activity', DEFAULTS);
  const [selectedUser, setSelectedUser] = useState<PlaybackUserActivity | null>(null);
  const [userHistory, setUserHistory] = useState<CustomHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Track the most recent request so an out-of-order response from an earlier
  // click can't overwrite the history of the user that's currently selected.
  const latestHistoryRequestRef = useRef<string | null>(null);

  const fetchFn = useCallback(() => fetchUserActivity(filters.days), [filters.days]);
  const { data, loading } = useWidgetData<UserActivityData>({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `jellyfin-user-activity-${filters.days}`,
  });

  const users = data?.users ?? [];
  const jellyfinUsers = data?.jellyfinUsers ?? [];
  const pluginAvailable = data?.pluginAvailable !== false;

  async function openUserHistory(user: PlaybackUserActivity) {
    const requestedUserId = user.user_id;
    latestHistoryRequestRef.current = requestedUserId;
    setSelectedUser(user);
    setUserHistory([]);
    setHistoryLoading(true);
    try {
      const to = toDateStr(new Date());
      const from = new Date();
      from.setDate(from.getDate() - 30);
      const res = await fetch(
        `/api/jellyfin/playback/custom-history?from=${toDateStr(from)}&to=${to}&userId=${requestedUserId}&limit=30`,
      );
      // Bail if a newer click superseded this fetch.
      if (latestHistoryRequestRef.current !== requestedUserId) return;
      if (res.ok) {
        const d = await res.json();
        setUserHistory(d.items ?? []);
      } else {
        setUserHistory([]);
      }
    } catch {
      if (latestHistoryRequestRef.current === requestedUserId) setUserHistory([]);
    } finally {
      if (latestHistoryRequestRef.current === requestedUserId) setHistoryLoading(false);
    }
  }

  const badge = (
    <DaysPill
      value={filters.days}
      options={JELLYFIN_DAYS_OPTIONS}
      onChange={(days) => setFilters({ days })}
      disabled={editMode}
      narrow={narrow}
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <SectionHeader title="Jellyfin Users" badge={badge} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} className="no-scrollbar">
        {!pluginAvailable ? (
          <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>
            Playback Reporting Plugin not detected.
          </div>
        ) : loading && users.length === 0 ? (
          <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
        ) : users.length === 0 ? (
          <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>No user activity found.</div>
        ) : (
          <div className="space-y-2">
            {users.map((user) => {
              const jfUser = jellyfinUsers.find((u) => u.Id === user.user_id);
              const avatarSrc = jfUser?.PrimaryImageTag
                ? `/api/jellyfin/image?itemId=${user.user_id}&type=Primary&maxWidth=80&quality=80`
                : null;
              return (
                <button
                  key={user.user_id}
                  type="button"
                  onClick={editMode ? undefined : () => openUserHistory(user)}
                  className="w-full text-left rounded-xl bg-muted/30 p-3 active:bg-muted/50 transition-colors @max-[219px]/cell:p-2"
                >
                  <div className="flex items-center gap-3 @max-[219px]/cell:gap-2">
                    {/* Avatar is decoration — dropped on compact cells. */}
                    <div className="h-9 w-9 rounded-full bg-[var(--hpr-cyan)]/20 flex items-center justify-center shrink-0 overflow-hidden @max-[219px]/cell:hidden">
                      {avatarSrc ? (
                        <Image
                          src={avatarSrc}
                          alt={user.user_name}
                          width={36}
                          height={36}
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <span className="text-sm font-bold text-[var(--hpr-cyan)]">
                          {user.user_name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{user.user_name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {user.item_name || 'No recent activity'}
                        {/* Client is tertiary — dropped on compact cells. */}
                        <span className="@max-[219px]/cell:hidden"> · {user.client_name}</span>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      {/* "3 days ago" → "3d" on compact cells. */}
                      <p className="text-[10px] text-muted-foreground @max-[219px]/cell:hidden">{user.last_seen}</p>
                      <p className="hidden text-[10px] text-muted-foreground @max-[219px]/cell:block">{shortPluginDuration(user.last_seen, 1)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{user.total_count} plays</Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 max-w-full">
                      {/* "2 weeks 1 day 17 hours 35 minutes" → "2w 1d" once the pill can't fit. */}
                      <span className="truncate @max-[259px]/cell:hidden">{user.total_play_time}</span>
                      <span className="hidden @max-[259px]/cell:inline">{shortPluginDuration(user.total_play_time)}</span>
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Drawer open={!!selectedUser} onOpenChange={(open) => { if (!open) setSelectedUser(null); }}>
        <DrawerContent>
          {selectedUser && (
            <>
              <DrawerHeader className="text-left">
                <DrawerTitle className="text-sm">{selectedUser.user_name} — Recent Plays</DrawerTitle>
                <p className="text-xs text-muted-foreground">
                  {selectedUser.total_count} total plays · {selectedUser.total_play_time}
                </p>
              </DrawerHeader>
              <div className="px-3 pb-6 flex-1 min-h-0 overflow-y-auto">
                {historyLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
                ) : userHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No plays in the last 30 days</p>
                ) : (
                  <div className="space-y-1">
                    {userHistory.map((e) => (
                      <div key={e.RowId} className="flex items-center justify-between py-1.5 px-1 text-xs gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="truncate">{e.ItemName}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {e.ClientName} · {e.DeviceName} · {formatDurationSeconds(e.PlayDuration)}
                          </p>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatDateCreated(e.DateCreated)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
