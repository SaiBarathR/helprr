'use client';

import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { WidgetProps } from '@/lib/widgets/types';
import { HPR, SectionHeader, mix, FONT_MONO } from './bento-primitives';
import type { SeerrPaginated, SeerrUserSummary } from '@/types/seerr';

const ROW_HEIGHT = 48;
const USERS_FETCH_SIZE = 50;
// Full-page card grid: packs 2–4 users per row so the viewer scans far fewer
// rows than a 1-per-row list, and the window scroll reveals every fetched user.
const GRID_CLASS = 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

async function fetchUsers(): Promise<SeerrPaginated<SeerrUserSummary>> {
  const params = new URLSearchParams({
    take: String(USERS_FETCH_SIZE),
    skip: '0',
    sort: 'requests',
  });
  const res = await fetch(`/api/seerr/users?${params.toString()}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed (${res.status})`);
  }
  return (await res.json()) as SeerrPaginated<SeerrUserSummary>;
}

function userLabel(user: SeerrUserSummary): string {
  return (
    user.displayName ??
    user.username ??
    user.plexUsername ??
    user.jellyfinUsername ??
    user.email ??
    `User ${user.id}`
  );
}

export interface RequestsUsersWidgetProps extends WidgetProps {
  hideHeader?: boolean;
  /**
   * Full-page mode: render every fetched user as a responsive card grid
   * (no height cap). Leave off for the height-capped dashboard widget cell.
   */
  unbounded?: boolean;
}

export function RequestsUsersWidget({
  refreshInterval,
  editMode = false,
  hideHeader = false,
  unbounded = false,
}: RequestsUsersWidgetProps) {
  const { ref, height } = useElementSize<HTMLDivElement>();
  const { visibleCount: maxItems } = useListFetchSize({
    height,
    rowHeight: ROW_HEIGHT,
    bucketSize: 5,
  });
  const { data, loading, error } = useWidgetData<SeerrPaginated<SeerrUserSummary>>({
    fetchFn: fetchUsers,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'seerr-users',
  });

  const users = useMemo(() => data?.results ?? [], [data]);
  const header = hideHeader ? null : <SectionHeader title="Seerr Users" />;
  const shellClass = cn('flex min-h-0 flex-col', !unbounded && 'h-full');

  if (loading && users.length === 0) {
    return (
      <div ref={ref} className={shellClass}>
        {header}
        {unbounded ? (
          <div className={GRID_CLASS}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={emptyShellStyle}>
            <span style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</span>
          </div>
        )}
      </div>
    );
  }
  if (error && users.length === 0) {
    return (
      <div ref={ref} className={shellClass}>
        {header}
        {unbounded ? (
          <div className="py-10 text-center text-sm text-rose-400">{error}</div>
        ) : (
          <div style={emptyShellStyle}>
            <span style={{ fontSize: 11, color: HPR.rose }}>{error}</span>
          </div>
        )}
      </div>
    );
  }
  if (users.length === 0) {
    return (
      <div ref={ref} className={shellClass}>
        {header}
        {unbounded ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <Users className="h-6 w-6 opacity-50" />
            <p className="text-sm">No users found</p>
          </div>
        ) : (
          <div style={emptyShellStyle}>
            <span style={{ fontSize: 11, color: HPR.fgSubtle }}>No users found</span>
          </div>
        )}
      </div>
    );
  }

  // Full page: a responsive card grid showing every fetched user.
  if (unbounded) {
    return (
      <div ref={ref} className={shellClass}>
        {header}
        <div className={GRID_CLASS}>
          {users.map((user) => {
            const movieLimit = user.movieQuotaLimit ?? null;
            const tvLimit = user.tvQuotaLimit ?? null;
            return (
              <div
                key={user.id}
                className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
                  <Users className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{userLabel(user)}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>{user.requestCount ?? 0} requests</span>
                    {movieLimit !== null ? <span>Movies {movieLimit}</span> : null}
                    {tvLimit !== null ? <span>TV {tvLimit}</span> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Dashboard widget cell: compact, height-capped list inside the bento scroll box.
  return (
    <div ref={ref} className={shellClass}>
      {header}
      <div
        className="no-scrollbar scroll-fade-y"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
        {users.slice(0, maxItems).map((user) => {
          const movieLimit = user.movieQuotaLimit ?? null;
          const tvLimit = user.tvQuotaLimit ?? null;
          return (
            <div
              key={user.id}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: '6px 10px',
                background: HPR.ink,
                border: `1px solid ${HPR.hairline}`,
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: mix(HPR.amber, 14),
                  color: HPR.amber,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Users size={12} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: HPR.fg,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {userLabel(user)}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: HPR.fgMute,
                    fontFamily: FONT_MONO,
                    display: 'flex',
                    gap: 8,
                  }}
                >
                  <span>{user.requestCount ?? 0} requests</span>
                  {movieLimit !== null ? <span>Movies {movieLimit}</span> : null}
                  {tvLimit !== null ? <span>TV {tvLimit}</span> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const emptyShellStyle = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'flex-start',
  padding: '6px 0',
} as const;
