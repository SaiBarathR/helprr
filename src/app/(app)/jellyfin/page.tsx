'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import type { DateRange } from 'react-day-picker';
import {
  Film,
  Tv,
  MonitorPlay,
  RefreshCw,
  Loader2,
  Server,
  Users,
  Clock,
  Library,
  AlertCircle,
  CheckCircle2,
  Clapperboard,
  CalendarIcon,
  ArrowUpDown,
  ChevronDown,
} from 'lucide-react';
import type {
  JellyfinSession,
  JellyfinItem,
  JellyfinSystemInfo,
  JellyfinLibrary,
  JellyfinItemCounts,
  JellyfinUser,
  JellyfinScheduledTask,
  PlaybackUserActivity,
  PlaybackBreakdownEntry,
  PlayActivityUser,
  CustomHistoryItem,
} from '@/types/jellyfin';
import { ticksToMinutes, formatDurationSeconds } from '@/lib/jellyfin-helpers';
import { isProtectedApiImageSrc } from '@/lib/image';
import { SessionCard } from '@/components/jellyfin/session-card';
import { StreamInfoDrawer } from '@/components/jellyfin/stream-info-drawer';

// ─── Helpers ───

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr(): string {
  return toDateStr(new Date());
}

function isAbortError(error: unknown): boolean {
  return (error as { name?: string })?.name === 'AbortError';
}

function formatDateCreated(dateStr: string): string {
  // DateCreated is UTC e.g. "2026-02-20 19:11:07.0338097"
  try {
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date)
  } catch (error) {
    console.error("Failed to parse date:", error);
    return dateStr;
  }
}

// ─── Types ───

type TabKey = 'overview' | 'users' | 'history' | 'stats';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'history', label: 'History' },
  { key: 'stats', label: 'Stats' },
];

const DAY_RANGES = [7, 14, 30, 90, 0]; // 0 = All Time
const MAX_DAYS = 18250;

// ─── Main Page ───

export default function JellyfinPage() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshingRef = useRef(refreshing);
  const refreshObservedLoadRef = useRef(false);
  const refreshPendingRef = useRef(0);

  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  const incrementPending = useCallback(() => {
    if (!refreshingRef.current) return;
    refreshObservedLoadRef.current = true;
    refreshPendingRef.current += 1;
  }, []);

  const decrementPending = useCallback(() => {
    if (!refreshingRef.current || !refreshObservedLoadRef.current) return;
    refreshPendingRef.current = Math.max(0, refreshPendingRef.current - 1);
    if (refreshPendingRef.current === 0) {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  // function handleRefresh() {
  //   refreshingRef.current = true;
  //   setRefreshing(true);
  //   refreshObservedLoadRef.current = false;
  //   refreshPendingRef.current = 0;
  //   setRefreshKey((k) => k + 1);
  // }

  return (
    <div className="flex flex-col min-h-0">
      {/* <div className="flex items-center justify-between px-2 pt-3 pb-2">
        <h1 className="text-xl font-bold">Jellyfin</h1>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div> */}

      <div className="px-2 pb-3 pt-3">
        <div role="tablist" aria-label="Jellyfin sections" className="flex bg-muted/50 rounded-lg p-0.5 gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              id={`tab-${t.key}`}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              aria-controls={`panel-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => setTab(t.key)}
              className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors ${tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {tab === 'overview' && <OverviewTab key={`o-${refreshKey}`} onLoadStart={incrementPending} onLoadEnd={decrementPending} />}
          {tab === 'users' && <UsersTab key={`u-${refreshKey}`} onLoadStart={incrementPending} onLoadEnd={decrementPending} />}
          {tab === 'history' && <HistoryTab key={`h-${refreshKey}`} onLoadStart={incrementPending} onLoadEnd={decrementPending} />}
          {tab === 'stats' && <StatsTab key={`s-${refreshKey}`} onLoadStart={incrementPending} onLoadEnd={decrementPending} />}
        </div>
      </div>
    </div>
  );
}

// ─── Shared UI ───

function Carousel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="relative">
      <div className={`flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide -mx-1 px-1 ${className}`}>
        {children}
      </div>
      <div className="pointer-events-none absolute top-0 right-0 bottom-2 w-8 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}

function SectionHeader({ title, badge, trailing }: { title: string; badge?: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {badge}
      </div>
      {trailing}
    </div>
  );
}

function PluginNotice() {
  return (
    <div className="rounded-xl bg-muted/30 p-6 text-center">
      <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
      <p className="text-sm font-medium text-muted-foreground">Playback Reporting Plugin not detected</p>
      <p className="text-xs text-muted-foreground/70 mt-1">Install the Jellyfin Playback Reporting Plugin for watch history and statistics.</p>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 1: OVERVIEW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type TabLoadCallbacks = {
  onLoadStart?: () => void;
  onLoadEnd?: () => void;
};

function OverviewTab({ onLoadStart, onLoadEnd }: TabLoadCallbacks) {
  const [system, setSystem] = useState<JellyfinSystemInfo | null>(null);
  const [sessions, setSessions] = useState<JellyfinSession[]>([]);
  const [resumeItems, setResumeItems] = useState<JellyfinItem[]>([]);
  const [counts, setCounts] = useState<JellyfinItemCounts | null>(null);
  const [recentlyAdded, setRecentlyAdded] = useState<JellyfinItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<JellyfinSession | null>(null);

  const fetchData = useCallback(async () => {
    const [sysRes, sessRes, resumeRes, countsRes, recentRes] = await Promise.allSettled([
      fetch('/api/jellyfin/system'),
      fetch('/api/jellyfin/sessions'),
      fetch('/api/jellyfin/resume'),
      fetch('/api/jellyfin/counts'),
      fetch('/api/jellyfin/recently-added?limit=20'),
    ]);
    if (sysRes.status === 'fulfilled' && sysRes.value.ok) setSystem((await sysRes.value.json()).system);
    if (sessRes.status === 'fulfilled' && sessRes.value.ok) setSessions((await sessRes.value.json()).sessions || []);
    if (resumeRes.status === 'fulfilled' && resumeRes.value.ok) setResumeItems((await resumeRes.value.json()).items || []);
    if (countsRes.status === 'fulfilled' && countsRes.value.ok) setCounts((await countsRes.value.json()).counts);
    if (recentRes.status === 'fulfilled' && recentRes.value.ok) setRecentlyAdded((await recentRes.value.json()).items || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    onLoadStart?.();
    void Promise.resolve()
      .then(fetchData)
      .finally(() => {
        if (active) onLoadEnd?.();
      });
    const interval = setInterval(() => {
      void fetchData();
    }, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [fetchData, onLoadStart, onLoadEnd]);

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-12 rounded-xl" />
        <div className="grid gap-3 grid-cols-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {system && (
        <div className="rounded-xl bg-card p-3 flex items-center gap-3">
          <div className="rounded-lg bg-[#00a4dc]/10 p-2"><Server className="h-4 w-4 text-[#00a4dc]" /></div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{system.ServerName}</p>
            <p className="text-xs text-muted-foreground">v{system.Version}</p>
          </div>
          <div className="flex gap-1.5">
            {system.HasPendingRestart && <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-500 border-amber-500/30">Restart needed</Badge>}
            {system.HasUpdateAvailable && <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-blue-500 border-blue-500/30">Update available</Badge>}
            {!system.HasPendingRestart && !system.HasUpdateAvailable && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-green-500 border-green-500/30"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />Healthy</Badge>
            )}
          </div>
        </div>
      )}

      {sessions.length > 0 && (
        <div>
          <SectionHeader title="Active Sessions" badge={
            <span className="flex items-center gap-1.5 text-xs">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="text-green-400 tabular-nums">{sessions.length}</span>
            </span>
          } />
          <Carousel>{sessions.map((s) => <SessionCard key={s.Id} session={s} variant="full" onInfoClick={setSelectedSession} />)}</Carousel>
        </div>
      )}

      {counts && (
        <div className="grid gap-3 grid-cols-2">
          <StatCard icon={Film} color="blue" value={counts.MovieCount} label="Movies" />
          <StatCard icon={Tv} color="purple" value={counts.SeriesCount} label="Series" />
          <StatCard icon={Clapperboard} color="indigo" value={counts.EpisodeCount} label="Episodes" />
          <StatCard icon={MonitorPlay} color="green" value={sessions.length} label="Streams" />
        </div>
      )}


      {resumeItems.length > 0 && (
        <div>
          <SectionHeader title="Continue Watching" />
          <Carousel>{resumeItems.map((item) => <PosterCard key={item.Id} item={item} showProgress />)}</Carousel>
        </div>
      )}

      {recentlyAdded.length > 0 && (
        <div>
          <SectionHeader title="Recently Added" />
          <Carousel>{recentlyAdded.map((item) => <PosterCard key={item.Id} item={item} />)}</Carousel>
        </div>
      )}
      <StreamInfoDrawer session={selectedSession} onClose={() => setSelectedSession(null)} />
    </div>
  );
}

function PosterCard({ item, showProgress }: { item: JellyfinItem; showProgress?: boolean }) {
  const progress = item.UserData?.PlayedPercentage ?? 0;
  const imageId = item.Type === 'Episode' && item.SeriesId ? item.SeriesId : item.Id;
  const hasImage = item.ImageTags?.Primary || (item.Type === 'Episode' && item.SeriesId);
  const posterSrc = `/api/jellyfin/image?itemId=${imageId}&type=Primary&maxWidth=220&quality=90`;
  return (
    <div className="snap-start shrink-0 w-[110px]">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted mb-1.5 shadow-sm">
        {hasImage ? <Image src={posterSrc} alt={item.Name} fill sizes="110px" className="object-cover" unoptimized={isProtectedApiImageSrc(posterSrc)} /> : (
          <div className="w-full h-full flex items-center justify-center"><MonitorPlay className="h-6 w-6 text-muted-foreground/20" /></div>
        )}
        <div className="absolute top-1.5 left-1.5">
          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${item.Type === 'Movie' ? 'bg-blue-500/80' : 'bg-purple-500/80'}`}>
            {item.Type === 'Movie' ? <Film className="h-2.5 w-2.5 text-white" /> : <Tv className="h-2.5 w-2.5 text-white" />}
          </span>
        </div>
        {showProgress && progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10"><div className="h-full bg-[#00a4dc]" style={{ width: `${progress}%` }} /></div>
        )}
      </div>
      <p className="text-[11px] font-medium truncate leading-tight">{item.SeriesName || item.Name}</p>
      {item.Type === 'Episode' && item.ParentIndexNumber != null && <p className="text-[10px] text-muted-foreground truncate">S{item.ParentIndexNumber}E{item.IndexNumber}</p>}
    </div>
  );
}

function StatCard({ icon: Icon, color, value, label }: { icon: React.ElementType; color: string; value: number; label: string }) {
  const c: Record<string, string> = { blue: 'bg-blue-500/10 text-blue-500', purple: 'bg-purple-500/10 text-purple-500', green: 'bg-green-500/10 text-green-500', indigo: 'bg-indigo-500/10 text-indigo-500' };
  return (
    <div className="rounded-xl bg-card p-4 flex items-center gap-3">
      <div className={`rounded-lg p-2.5 ${c[color] || c.blue}`}><Icon className="h-5 w-5" /></div>
      <div><p className="text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>
    </div>
  );
}

function LibraryCard({ library }: { library: JellyfinLibrary }) {
  const m: Record<string, React.ElementType> = { movies: Film, tvshows: Tv, music: Clapperboard, homevideos: MonitorPlay };
  const Icon = m[library.CollectionType || ''] || Library;
  return (
    <div className="rounded-xl bg-card p-3 flex items-center gap-3">
      <div className="rounded-lg bg-[#00a4dc]/10 p-2"><Icon className="h-4 w-4 text-[#00a4dc]" /></div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{library.Name}</p>
        <p className="text-xs text-muted-foreground">{library.CollectionType || 'Mixed'}{library.ChildCount != null && ` \u00B7 ${library.ChildCount} items`}</p>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 2: USERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function UsersTab({ onLoadStart, onLoadEnd }: TabLoadCallbacks) {
  const [users, setUsers] = useState<PlaybackUserActivity[]>([]);
  const [jellyfinUsers, setJellyfinUsers] = useState<JellyfinUser[]>([]);
  const [pluginAvailable, setPluginAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<PlaybackUserActivity | null>(null);
  const [userHistory, setUserHistory] = useState<CustomHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let active = true;

    async function fetch_() {
      const [pbRes, jfRes] = await Promise.allSettled([
        fetch(`/api/jellyfin/playback/users?days=${MAX_DAYS}`, { signal }),
        fetch('/api/jellyfin/users', { signal }),
      ]);
      if (signal.aborted || !active) return;

      if (pbRes.status === 'fulfilled' && pbRes.value.ok) {
        const d = await pbRes.value.json();
        if (signal.aborted || !active) return;
        setUsers(d.users || []);
        setPluginAvailable(d.pluginAvailable !== false);
      }
      if (jfRes.status === 'fulfilled' && jfRes.value.ok) {
        const d = await jfRes.value.json();
        if (signal.aborted || !active) return;
        setJellyfinUsers(d.users || []);
      }
      setLoading(false);
    }

    onLoadStart?.();
    void fetch_()
      .catch((error) => {
        if (isAbortError(error) || signal.aborted || !active) return;
        setLoading(false);
      })
      .finally(() => {
        if (!signal.aborted && active) {
          onLoadEnd?.();
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [onLoadStart, onLoadEnd]);

  async function openUserHistory(user: PlaybackUserActivity) {
    setSelectedUser(user);
    setHistoryLoading(true);
    try {
      const to = todayStr();
      const from = new Date();
      from.setDate(from.getDate() - 30);
      const res = await fetch(
        `/api/jellyfin/playback/custom-history?from=${toDateStr(from)}&to=${to}&userId=${user.user_id}&limit=30`
      );
      if (res.ok) {
        const d = await res.json();
        setUserHistory(d.items || []);
      } else {
        setUserHistory([]);
      }
    } catch {
      setUserHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  if (loading) return <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>;
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
                <div className="h-10 w-10 rounded-full bg-[#00a4dc]/20 flex items-center justify-center shrink-0 overflow-hidden">
                  {avatarSrc ? <Image src={avatarSrc} alt={user.user_name} width={40} height={40} className="object-cover" unoptimized /> : (
                    <span className="text-sm font-bold text-[#00a4dc]">{user.user_name.charAt(0).toUpperCase()}</span>
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
                <p className="text-xs text-muted-foreground">{selectedUser.total_count} total plays &middot; {selectedUser.total_play_time}</p>
              </DrawerHeader>
              <div className="px-2 pb-6 max-h-[60vh] overflow-y-auto">
                {historyLoading ? (
                  <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 3: HISTORY (uses submit_custom_query — single API call)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const QUICK_RANGES = [
  { label: '1d', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '3m', days: 90 },
];

const PAGE_SIZE = 50;

function HistoryTab({ onLoadStart, onLoadEnd }: TabLoadCallbacks) {
  const [items, setItems] = useState<CustomHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [pluginAvailable, setPluginAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [users, setUsers] = useState<{ name: string; id: string }[]>([]);
  const [filters, setFilters] = useState<string[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedFilter, setSelectedFilter] = useState<string>('');
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 6);
    return { from, to };
  });
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Load users and filters on mount
  useEffect(() => {
    async function loadMeta() {
      const [uRes, fRes] = await Promise.allSettled([
        fetch('/api/jellyfin/playback/user-list'),
        fetch('/api/jellyfin/playback/filters'),
      ]);
      if (uRes.status === 'fulfilled' && uRes.value.ok) {
        const d = await uRes.value.json();
        setUsers(d.users || []);
        setPluginAvailable(d.pluginAvailable !== false);
      }
      if (fRes.status === 'fulfilled' && fRes.value.ok) {
        const d = await fRes.value.json();
        setFilters(d.filters || []);
      }
    }
    loadMeta();
  }, []);

  // Build fetch URL from current filters
  const buildUrl = useCallback((pageOffset: number) => {
    if (!dateRange.from) return null;
    const from = toDateStr(dateRange.from);
    const to = toDateStr(dateRange.to || dateRange.from);
    const params = new URLSearchParams({
      from, to,
      limit: String(PAGE_SIZE),
      offset: String(pageOffset),
    });
    if (selectedUserId) params.set('userId', selectedUserId);
    if (selectedFilter) params.set('type', selectedFilter);
    return `/api/jellyfin/playback/custom-history?${params}`;
  }, [dateRange, selectedUserId, selectedFilter]);

  // Fetch history when params change (reset to page 0)
  useEffect(() => {
    const url = buildUrl(0);
    if (!url) { setLoading(false); return; }
    const controller = new AbortController();
    const { signal } = controller;

    onLoadStart?.();
    setLoading(true);
    setOffset(0);
    fetch(url, { signal })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (signal.aborted) return;
        if (d) {
          setItems(d.items || []);
          setTotal(d.total || 0);
          if (d.pluginAvailable === false) setPluginAvailable(false);
        } else {
          setItems([]);
          setTotal(0);
        }
      })
      .catch((error) => {
        if (isAbortError(error) || signal.aborted) return;
        setItems([]);
        setTotal(0);
      })
      .finally(() => {
        if (!signal.aborted) {
          setLoading(false);
          onLoadEnd?.();
        }
      });

    return () => controller.abort();
  }, [buildUrl, onLoadStart, onLoadEnd]);

  async function loadMore() {
    const nextOffset = offset + PAGE_SIZE;
    const url = buildUrl(nextOffset);
    if (!url) return;
    setLoadingMore(true);
    try {
      const res = await fetch(url);
      if (res.ok) {
        const d = await res.json();
        setItems((prev) => [...prev, ...(d.items || [])]);
        setOffset(nextOffset);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  function applyQuickRange(days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days + 1);
    setDateRange({ from, to });
  }

  if (!pluginAvailable) return <PluginNotice />;

  const fromStr = dateRange.from ? dateRange.from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const toStr = dateRange.to ? dateRange.to.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : fromStr;
  const rangeLabel = fromStr === toStr ? fromStr : `${fromStr} — ${toStr}`;
  const hasMore = items.length < total;

  return (
    <div className="space-y-3">
      {/* Quick range buttons */}
      <div className="flex gap-1.5">
        {QUICK_RANGES.map((r) => (
          <button key={r.label} onClick={() => applyQuickRange(r.days)} className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted/50 text-muted-foreground hover:text-foreground transition-colors">
            {r.label}
          </button>
        ))}
      </div>

      {/* Date range picker */}
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start text-left text-xs h-9 font-normal">
            <CalendarIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
            {rangeLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={dateRange}
            onSelect={(range) => {
              if (range) setDateRange(range);
              if (range?.to) setCalendarOpen(false);
            }}
            disabled={{ after: new Date() }}
            numberOfMonths={1}
          />
        </PopoverContent>
      </Popover>

      {/* User + type filters */}
      <div className="flex gap-2">
        <Select value={selectedUserId || 'all'} onValueChange={(v) => setSelectedUserId(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="All users" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {filters.length > 0 && (
          <Select value={selectedFilter || 'all'} onValueChange={(v) => setSelectedFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {filters.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Result count */}
      {!loading && total > 0 && (
        <p className="text-[11px] text-muted-foreground">{total} plays found</p>
      )}

      {/* History list */}
      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground"><Clock className="h-8 w-8 mx-auto mb-2 opacity-40" /><p className="text-sm">No plays found</p></div>
      ) : (
        <>
          <div className="space-y-1">{items.map((e) => <CustomHistoryRow key={e.RowId} item={e} />)}</div>
          {hasMore && (
            <Button variant="outline" className="w-full text-xs h-9" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <ChevronDown className="h-3.5 w-3.5 mr-2" />}
              Load more ({items.length} of {total})
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// ─── History Row (for CustomHistoryItem from submit_custom_query) ───

function getMethodInfo(method: string): { label: string; colorClass: string } {
  const m = method.toLowerCase();
  if (m.startsWith('directplay')) return { label: method, colorClass: 'text-green-500 border-green-500/30' };
  if (m.startsWith('directstream')) return { label: method, colorClass: 'text-blue-500 border-blue-500/30' };
  if (m.startsWith('transcode')) return { label: method, colorClass: 'text-orange-500 border-orange-500/30' };
  return { label: method, colorClass: '' };
}

function CustomHistoryRow({ item }: { item: CustomHistoryItem }) {
  const { label: methodLabel, colorClass: methodColor } = getMethodInfo(item.PlaybackMethod);

  return (
    <div className="flex items-center gap-3 py-1 px-0 rounded-lg hover:bg-muted/30">
      <div className="p-1.5 rounded bg-muted shrink-0">
        {item.ItemType === 'Movie' ? <Film className="h-3.5 w-3.5 text-muted-foreground" /> :
          item.ItemType === 'Episode' ? <Tv className="h-3.5 w-3.5 text-muted-foreground" /> :
            <MonitorPlay className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{item.ItemName}</p>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{item.ClientName}</span><span>&middot;</span><span>{item.DeviceName}</span><span>&middot;</span><span>{formatDurationSeconds(item.PlayDuration)}</span>
        </div>
      </div>
      <div className="text-right shrink-0 space-y-0.5">
        <Badge variant="outline" className={`text-[9px] px-1 py-0 ${methodColor}`}>{methodLabel}</Badge>
        <p className="text-[10px] text-muted-foreground">{formatDateCreated(item.DateCreated)}</p>
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 4: STATS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type SortMode = 'plays' | 'duration';

function StatsTab({ onLoadStart, onLoadEnd }: TabLoadCallbacks) {
  const [days, setDays] = useState(7);
  const [pluginAvailable, setPluginAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [playActivity, setPlayActivity] = useState<PlayActivityUser[]>([]);
  const [topTv, setTopTv] = useState<PlaybackBreakdownEntry[]>([]);
  const [topMovies, setTopMovies] = useState<PlaybackBreakdownEntry[]>([]);
  const [methodBreakdown, setMethodBreakdown] = useState<PlaybackBreakdownEntry[]>([]);
  const [clientBreakdown, setClientBreakdown] = useState<PlaybackBreakdownEntry[]>([]);
  const [deviceBreakdown, setDeviceBreakdown] = useState<PlaybackBreakdownEntry[]>([]);
  const [hourlyData, setHourlyData] = useState<Record<string, number>>({});
  const [tasks, setTasks] = useState<JellyfinScheduledTask[]>([]);
  const [methodSort, setMethodSort] = useState<SortMode>('duration');
  const [tvSort, setTvSort] = useState<SortMode>('duration');
  const [clientSort, setClientSort] = useState<SortMode>('duration');
  const [deviceSort, setDeviceSort] = useState<SortMode>('duration');
  const [movieSort, setMovieSort] = useState<SortMode>('duration');

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function fetchUsers() {
      try {
        const res = await fetch('/api/jellyfin/playback/user-list', { signal });
        if (!res.ok || signal.aborted) return;
        const data = await res.json();
        if (signal.aborted) return;

        setUsers(Array.isArray(data.users) ? data.users : []);
        if (data.pluginAvailable === false) setPluginAvailable(false);
      } catch (error) {
        if (isAbortError(error) || signal.aborted) return;
      }
    }

    void fetchUsers();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    async function fetchStats() {
      onLoadStart?.();
      setLoading(true);
      try {
        const queryDays = days === 0 ? MAX_DAYS : days;
        const params = new URLSearchParams({ days: String(queryDays) });
        if (selectedUserId) params.set('userId', selectedUserId);
        const query = params.toString();

        const [actRes, tvRes, movRes, methRes, clientRes, deviceRes, hourRes, taskRes] = await Promise.allSettled([
          fetch(`/api/jellyfin/playback/activity?${query}`, { signal }),
          fetch(`/api/jellyfin/playback/tv-shows?${query}`, { signal }),
          fetch(`/api/jellyfin/playback/movies?${query}`, { signal }),
          fetch(`/api/jellyfin/playback/breakdown/PlaybackMethod?${query}`, { signal }),
          fetch(`/api/jellyfin/playback/breakdown/ClientName?${query}`, { signal }),
          fetch(`/api/jellyfin/playback/breakdown/DeviceName?${query}`, { signal }),
          fetch(`/api/jellyfin/playback/hourly?${query}`, { signal }),
          fetch('/api/jellyfin/tasks', { signal }),
        ]);

        // Parse all JSON before any setState so updates batch in a single render
        let newActivity: PlayActivityUser[] = [];
        let newPluginAvailable = pluginAvailable;
        let newTopTv: PlaybackBreakdownEntry[] = [];
        let newTopMovies: PlaybackBreakdownEntry[] = [];
        let newMethodBreakdown: PlaybackBreakdownEntry[] = [];
        let newClientBreakdown: PlaybackBreakdownEntry[] = [];
        let newDeviceBreakdown: PlaybackBreakdownEntry[] = [];
        let newHourlyData: Record<string, number> = {};
        let newTasks: JellyfinScheduledTask[] = [];

        if (actRes.status === 'fulfilled' && actRes.value.ok) {
          const d = await actRes.value.json();
          newActivity = d.data || [];
          if (d.pluginAvailable === false) newPluginAvailable = false;
        }
        if (tvRes.status === 'fulfilled' && tvRes.value.ok) {
          const d = await tvRes.value.json();
          newTopTv = d.shows || [];
          if (d.pluginAvailable === false) newPluginAvailable = false;
        }
        if (movRes.status === 'fulfilled' && movRes.value.ok) {
          const d = await movRes.value.json();
          newTopMovies = d.movies || [];
          if (d.pluginAvailable === false) newPluginAvailable = false;
        }
        if (methRes.status === 'fulfilled' && methRes.value.ok) {
          const d = await methRes.value.json();
          newMethodBreakdown = d.entries || [];
          if (d.pluginAvailable === false) newPluginAvailable = false;
        }
        if (clientRes.status === 'fulfilled' && clientRes.value.ok) {
          const d = await clientRes.value.json();
          newClientBreakdown = d.entries || [];
          if (d.pluginAvailable === false) newPluginAvailable = false;
        }
        if (deviceRes.status === 'fulfilled' && deviceRes.value.ok) {
          const d = await deviceRes.value.json();
          newDeviceBreakdown = d.entries || [];
          if (d.pluginAvailable === false) newPluginAvailable = false;
        }
        if (hourRes.status === 'fulfilled' && hourRes.value.ok) {
          const d = await hourRes.value.json();
          newHourlyData = d.data || {};
          if (d.pluginAvailable === false) newPluginAvailable = false;
        }
        if (taskRes.status === 'fulfilled' && taskRes.value.ok) newTasks = (await taskRes.value.json()).tasks || [];

        if (signal.aborted) return;

        // All setState calls synchronous — React 18 batches into one render
        setPlayActivity(newActivity);
        setPluginAvailable(newPluginAvailable);
        setTopTv(newTopTv);
        setTopMovies(newTopMovies);
        setMethodBreakdown(newMethodBreakdown);
        setClientBreakdown(newClientBreakdown);
        setDeviceBreakdown(newDeviceBreakdown);
        setHourlyData(newHourlyData);
        setTasks(newTasks);
      } catch (error) {
        if (isAbortError(error) || signal.aborted) return;
      } finally {
        if (!signal.aborted) {
          setLoading(false);
          onLoadEnd?.();
        }
      }
    }
    fetchStats();
    return () => controller.abort();
  }, [days, selectedUserId, onLoadStart, onLoadEnd, pluginAvailable]);

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-48 rounded-lg" /><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>;

  if (!pluginAvailable) return <div className="space-y-5"><PluginNotice />{tasks.length > 0 && <ScheduledTasksList tasks={tasks} />}</div>;

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <div className="flex-1 min-w-0 max-w-xs">
          <Select
            value={String(days)}
            onValueChange={(value) => {
              const parsed = Number.parseInt(value, 10);
              setDays(Number.isNaN(parsed) ? 7 : parsed);
            }}
          >
            <SelectTrigger className="h-8 text-xs w-full">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              {DAY_RANGES.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d === 0 ? 'All time' : `${d} days`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {users.length > 0 && (
          <div className="flex-1 min-w-0 max-w-xs">
            <Select value={selectedUserId || 'all'} onValueChange={(v) => setSelectedUserId(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {playActivity.length > 0 && (
        <div>
          <SectionHeader title="Play Activity" />
          <PlayActivityChart data={playActivity} />
        </div>
      )}

      {topTv.length > 0 && (
        <div>
          <SectionHeader title="Top TV Shows" trailing={<SortToggle value={tvSort} onChange={setTvSort} />} />
          <RankedList entries={topTv} sortBy={tvSort} limit={10} />
        </div>
      )}

      {topMovies.length > 0 && (
        <div>
          <SectionHeader title="Top Movies" trailing={<SortToggle value={movieSort} onChange={setMovieSort} />} />
          <RankedList entries={topMovies} sortBy={movieSort} limit={10} />
        </div>
      )}

      {methodBreakdown.length > 0 && (
        <div>
          <SectionHeader title="Playback Methods" trailing={<SortToggle value={methodSort} onChange={setMethodSort} />} />
          <PlaybackMethodBar entries={methodBreakdown} sortBy={methodSort} />
        </div>
      )}

      {clientBreakdown.length > 0 && (
        <div>
          <SectionHeader title="Top Clients" trailing={<SortToggle value={clientSort} onChange={setClientSort} />} />
          <RankedList entries={clientBreakdown} sortBy={clientSort} limit={10} />
        </div>
      )}

      {deviceBreakdown.length > 0 && (
        <div>
          <SectionHeader title="Top Devices" trailing={<SortToggle value={deviceSort} onChange={setDeviceSort} />} />
          <RankedList entries={deviceBreakdown} sortBy={deviceSort} limit={10} />
        </div>
      )}

      {Object.keys(hourlyData).length > 0 && (
        <div>
          <SectionHeader title="Hourly Activity" />
          <HourlyHeatmap data={hourlyData} />
        </div>
      )}

      {tasks.length > 0 && <ScheduledTasksList tasks={tasks} />}
    </div>
  );
}

// ─── Sort Toggle ───

function SortToggle({ value, onChange }: { value: SortMode; onChange: (v: SortMode) => void }) {
  return (
    <button
      onClick={() => onChange(value === 'plays' ? 'duration' : 'plays')}
      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
    >
      <ArrowUpDown className="h-3 w-3" />
      {value === 'plays' ? 'Plays' : 'Duration'}
    </button>
  );
}

// ─── Play Activity Chart ───
// Data: [{user_id, user_name, user_usage: {date: count}}]

function PlayActivityChart({ data }: { data: PlayActivityUser[] }) {
  const chartData = useMemo(() => {
    const realUsers = data.filter((u) => u.user_id !== 'labels_user');
    if (realUsers.length === 0) return null;

    // Merge all users' usage, then strip zero-only dates
    const merged: Record<string, number> = {};
    for (const user of realUsers) {
      for (const [date, val] of Object.entries(user.user_usage)) {
        merged[date] = (merged[date] || 0) + (Number(val) || 0);
      }
    }

    const nonZeroEntries = Object.entries(merged)
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    if (nonZeroEntries.length === 0) return null;

    // Determine aggregation from actual data span, not the requested days
    const nonZeroCount = nonZeroEntries.length;
    let aggregated: [string, number][];
    let periodLabel: string;

    if (nonZeroCount <= 30) {
      aggregated = nonZeroEntries;
      periodLabel = 'daily';
    } else if (nonZeroCount <= 365) {
      // Weekly aggregation
      const weeks: [string, number][] = [];
      let weekSum = 0;
      let weekStart = nonZeroEntries[0][0];
      for (let i = 0; i < nonZeroEntries.length; i++) {
        weekSum += nonZeroEntries[i][1];
        if ((i + 1) % 7 === 0 || i === nonZeroEntries.length - 1) {
          weeks.push([weekStart, weekSum]);
          weekSum = 0;
          if (i + 1 < nonZeroEntries.length) weekStart = nonZeroEntries[i + 1][0];
        }
      }
      aggregated = weeks;
      periodLabel = 'weekly';
    } else {
      // Monthly aggregation
      const months: Record<string, number> = {};
      for (const [date, count] of nonZeroEntries) {
        const monthKey = date.substring(0, 7);
        months[monthKey] = (months[monthKey] || 0) + count;
      }
      aggregated = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
      periodLabel = 'monthly';
    }

    // Safety cap: if still > 60 bars, collapse to monthly
    if (aggregated.length > 60 && periodLabel !== 'monthly') {
      const months: Record<string, number> = {};
      for (const [date, count] of nonZeroEntries) {
        const monthKey = date.substring(0, 7);
        months[monthKey] = (months[monthKey] || 0) + count;
      }
      aggregated = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
      periodLabel = 'monthly';
    }

    const totalPlays = aggregated.reduce((s, [, v]) => s + v, 0);
    const maxVal = Math.max(...aggregated.map(([, v]) => v), 1);

    // Compute avg from actual date span
    const firstDate = new Date(nonZeroEntries[0][0] + 'T12:00:00');
    const lastDate = new Date(nonZeroEntries[nonZeroEntries.length - 1][0] + 'T12:00:00');
    const actualDays = Math.max(1, Math.round((lastDate.getTime() - firstDate.getTime()) / (86400000)) + 1);
    const avgPerDay = (totalPlays / actualDays).toFixed(1);

    const labelInterval = Math.max(1, Math.ceil(aggregated.length / 7));
    const isMonthly = periodLabel === 'monthly';

    // Pre-compute per-user stacked values (avoids work during render)
    let userBars: Record<string, number[]> | null = null;
    if (realUsers.length > 1) {
      userBars = {};

      if (periodLabel === 'daily') {
        for (const [label] of aggregated) {
          userBars[label] = realUsers.map((u) => Number(u.user_usage[label]) || 0);
        }
      } else if (periodLabel === 'weekly') {
        // Map each non-zero date to its week label
        const dateToWeekLabel: Record<string, string> = {};
        let curWeekStart = nonZeroEntries[0][0];
        for (let i = 0; i < nonZeroEntries.length; i++) {
          dateToWeekLabel[nonZeroEntries[i][0]] = curWeekStart;
          if ((i + 1) % 7 === 0 && i + 1 < nonZeroEntries.length) {
            curWeekStart = nonZeroEntries[i + 1][0];
          }
        }
        for (const [label] of aggregated) userBars[label] = realUsers.map(() => 0);
        for (const [date] of nonZeroEntries) {
          const wl = dateToWeekLabel[date];
          if (wl && userBars[wl]) {
            realUsers.forEach((u, i) => { userBars![wl][i] += Number(u.user_usage[date]) || 0; });
          }
        }
      } else {
        // Monthly
        for (const [label] of aggregated) userBars[label] = realUsers.map(() => 0);
        for (const [date] of nonZeroEntries) {
          const mk = date.substring(0, 7);
          if (userBars[mk]) {
            realUsers.forEach((u, i) => { userBars![mk][i] += Number(u.user_usage[date]) || 0; });
          }
        }
      }
    }

    return { realUsers, aggregated, totalPlays, maxVal, avgPerDay, periodLabel, labelInterval, userBars, isMonthly };
  }, [data]);

  if (!chartData) return null;
  const { realUsers, aggregated, totalPlays, maxVal, avgPerDay, periodLabel, labelInterval, userBars, isMonthly } = chartData;

  return (
    <div className="rounded-xl bg-card p-3">
      {/* Summary */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-lg font-bold tabular-nums">{totalPlays}</span>
        <span className="text-xs text-muted-foreground">total plays</span>
        <span className="text-xs text-muted-foreground ml-auto">~{avgPerDay}/day avg</span>
      </div>

      {/* Per-user legend if multiple users */}
      {realUsers.length > 1 && (
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          {realUsers.map((u, i) => (
            <div key={u.user_id} className="flex items-center gap-1 text-[10px]">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: USER_COLORS[i % USER_COLORS.length] }} />
              <span className="text-muted-foreground">{u.user_name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bars */}
      <div className="flex items-end gap-[2px] h-24">
        {aggregated.map(([label, count]) => {
          const pct = (count / maxVal) * 100;

          if (userBars && userBars[label]) {
            const userValues = userBars[label];
            const userTotal = userValues.reduce((s, v) => s + v, 0) || 1;
            return (
              <div key={label} className="flex-1 flex flex-col items-center justify-end h-full min-w-0" title={`${label}: ${count}`}>
                <div className="w-full rounded-t-sm overflow-hidden min-h-[2px] flex flex-col-reverse" style={{ height: `${Math.max(pct, 2)}%` }}>
                  {userValues.map((val, i) => {
                    if (val === 0) return null;
                    return (
                      <div key={i} style={{
                        height: `${(val / userTotal) * 100}%`,
                        backgroundColor: USER_COLORS[i % USER_COLORS.length],
                        minHeight: 1,
                      }} />
                    );
                  })}
                </div>
              </div>
            );
          }

          return (
            <div key={label} className="flex-1 flex flex-col items-center justify-end h-full min-w-0" title={`${label}: ${count}`}>
              <div className="w-full rounded-t-sm bg-[#00a4dc] min-h-[2px]" style={{ height: `${Math.max(pct, 2)}%` }} />
            </div>
          );
        })}
      </div>

      {/* Date labels */}
      <div className="flex gap-[2px] mt-1">
        {aggregated.map(([label], i) => (
          <div key={label} className="flex-1 text-center min-w-0">
            {(i % labelInterval === 0 || i === aggregated.length - 1) ? (
              <span className="text-[8px] text-muted-foreground">
                {isMonthly
                  ? new Date(label + '-15').toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
                  : new Date(label + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                }
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground mt-1.5 text-center">{periodLabel} view</p>
    </div>
  );
}

const USER_COLORS = ['#00a4dc', '#e5a00d', '#00c853', '#ff5252', '#7c4dff', '#ff6d00'];

// ─── Ranked List (with sort toggle) ───

function RankedList({ entries, sortBy, limit }: { entries: PlaybackBreakdownEntry[]; sortBy: SortMode; limit?: number }) {
  const sorted = useMemo(() => {
    return [...entries]
      .map((e) => ({ ...e, count: Number(e.count) || 0, time: Number(e.time) || 0 }))
      .sort((a, b) => sortBy === 'duration' ? b.time - a.time : b.count - a.count)
      .slice(0, limit ?? entries.length);
  }, [entries, sortBy, limit]);

  const maxVal = Math.max(...sorted.map((e) => sortBy === 'duration' ? e.time : e.count), 1);

  return (
    <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/50">
      {sorted.map((entry, i) => (
        <div key={entry.label} className="relative px-3 py-2.5 flex items-center gap-3">
          <div className="absolute inset-0 bg-[#00a4dc]/5" style={{ width: `${((sortBy === 'duration' ? entry.time : entry.count) / maxVal) * 100}%` }} />
          <span className="text-xs text-muted-foreground font-mono w-5 shrink-0 relative">{i + 1}</span>
          <span className="text-sm truncate flex-1 relative">{entry.label}</span>
          <div className="text-right shrink-0 relative">
            <span className="text-xs font-medium tabular-nums">
              {sortBy === 'duration' ? formatDurationSeconds(entry.time) : `${entry.count} plays`}
            </span>
            <p className="text-[10px] text-muted-foreground">
              {sortBy === 'duration' ? `${entry.count} plays` : entry.time > 0 ? formatDurationSeconds(entry.time) : ''}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Playback Method Bar (detailed — no grouping) ───

function PlaybackMethodBar({ entries, sortBy }: { entries: PlaybackBreakdownEntry[]; sortBy: SortMode }) {
  const normalized = entries
    .map((e) => ({ ...e, count: Number(e.count) || 0, time: Number(e.time) || 0 }))
    .sort((a, b) => sortBy === 'duration' ? b.time - a.time : b.count - a.count);
  const total = normalized.reduce((sum, e) => sum + (sortBy === 'duration' ? e.time : e.count), 0) || 1;

  function getColor(label: string) {
    const m = label.toLowerCase();
    if (m.startsWith('directplay')) return { bar: 'bg-green-500', dot: 'bg-green-500', text: 'text-green-500' };
    if (m.startsWith('directstream')) return { bar: 'bg-blue-500', dot: 'bg-blue-500', text: 'text-blue-500' };
    if (m.startsWith('transcode')) return { bar: 'bg-orange-500', dot: 'bg-orange-500', text: 'text-orange-500' };
    return { bar: 'bg-muted', dot: 'bg-muted', text: 'text-muted-foreground' };
  }

  return (
    <div className="rounded-xl bg-card p-3 px-2 space-y-3">
      {/* Stacked bar */}
      <div className="flex h-5 rounded-full overflow-hidden">
        {normalized.map((e) => {
          const metric = sortBy === 'duration' ? e.time : e.count;
          const pct = (metric / total) * 100;
          if (pct < 0.5) return null;
          return <div key={e.label} className={`${getColor(e.label).bar} transition-all`} style={{ width: `${pct}%` }} title={`${e.label}: ${pct.toFixed(1)}%`} />;
        })}
      </div>

      {/* Detailed breakdown list */}
      <div className="space-y-1">
        {normalized.map((e) => {
          const metric = sortBy === 'duration' ? e.time : e.count;
          const pct = ((metric / total) * 100).toFixed(1);
          const colors = getColor(e.label);
          return (
            <div key={e.label} className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
              <span className="text-xs truncate flex-1">{e.label}</span>
              <span className="text-[11px] font-medium tabular-nums shrink-0">
                {sortBy === 'duration' ? formatDurationSeconds(e.time) : e.count}
              </span>
              <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right shrink-0">{pct}%</span>
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {sortBy === 'duration' ? `${e.count} plays` : formatDurationSeconds(e.time)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Hourly Heatmap ───
// Data keys: "dayIdx-hour" e.g. "0-00" through "6-23", values = seconds

function HourlyHeatmap({ data }: { data: Record<string, number> }) {
  const values = Object.values(data).filter((v) => v > 0);
  const maxVal = Math.max(...values, 1);
  const totalSecs = values.reduce((s, v) => s + v, 0);
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Find peak hour
  let peakDay = 0;
  let peakHour = 0;
  let peakVal = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const key = `${d}-${String(h).padStart(2, '0')}`;
      const v = data[key] || 0;
      if (v > peakVal) { peakVal = v; peakDay = d; peakHour = h; }
    }
  }

  return (
    <div className="rounded-xl bg-card p-3 space-y-2">
      {/* Summary */}
      <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span>Total: {formatDurationSeconds(totalSecs)}</span>
        {peakVal > 0 && <span>Peak: {dayLabels[peakDay]} {peakHour}:00</span>}
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <div className="min-w-[300px]">
          <div className="flex ml-8 mb-0.5">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="flex-1 text-center text-[7px] text-muted-foreground">{h % 4 === 0 ? `${h}` : ''}</div>
            ))}
          </div>
          {dayLabels.map((day, dayIdx) => (
            <div key={day} className="flex items-center gap-1 mb-[2px]">
              <span className="text-[8px] text-muted-foreground w-7 shrink-0 text-right">{day}</span>
              <div className="flex-1 flex gap-[1px]">
                {Array.from({ length: 24 }, (_, h) => {
                  const key = `${dayIdx}-${String(h).padStart(2, '0')}`;
                  const val = data[key] || 0;
                  const intensity = val / maxVal;
                  return (
                    <div key={h} className="flex-1 aspect-square rounded-[2px]" style={{
                      backgroundColor: intensity > 0 ? `rgba(0, 164, 220, ${0.12 + intensity * 0.88})` : 'rgba(255,255,255,0.03)',
                    }} title={`${day} ${h}:00 — ${formatDurationSeconds(val)}`} />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1">
        <span className="text-[8px] text-muted-foreground mr-0.5">Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((i) => (
          <div key={i} className="w-3 h-3 rounded-[2px]" style={{
            backgroundColor: i === 0 ? 'rgba(255,255,255,0.03)' : `rgba(0, 164, 220, ${0.12 + i * 0.88})`,
          }} />
        ))}
        <span className="text-[8px] text-muted-foreground ml-0.5">More</span>
      </div>
    </div>
  );
}

// ─── Scheduled Tasks ───

function ScheduledTasksList({ tasks }: { tasks: JellyfinScheduledTask[] }) {
  const active = tasks.filter((t) => t.State === 'Running' || t.State === 'Cancelling');
  const recent = tasks.filter((t) => t.State === 'Idle' && t.LastExecutionResult)
    .sort((a, b) => (b.LastExecutionResult?.EndTimeUtc || '').localeCompare(a.LastExecutionResult?.EndTimeUtc || ''))
    .slice(0, 5);
  if (active.length === 0 && recent.length === 0) return null;

  return (
    <div>
      <SectionHeader title="Scheduled Tasks" />
      <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/50">
        {active.map((t) => (
          <div key={t.Id} className="px-3 py-2.5 flex items-center gap-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00a4dc] shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{t.Name}</p>
              {t.CurrentProgressPercentage != null && <Progress value={t.CurrentProgressPercentage} className="h-1 mt-1" />}
            </div>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">{t.CurrentProgressPercentage != null ? `${t.CurrentProgressPercentage.toFixed(0)}%` : 'Running'}</span>
          </div>
        ))}
        {recent.map((t) => (
          <div key={t.Id} className="px-3 py-2.5 flex items-center gap-3">
            <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${t.LastExecutionResult?.Status === 'Completed' ? 'text-green-500' : 'text-amber-500'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{t.Name}</p>
              <p className="text-[10px] text-muted-foreground">{t.Category}</p>
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0">{t.LastExecutionResult?.Status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
