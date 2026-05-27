'use client';

import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import type { WidgetProps } from '@/lib/widgets/types';
import { HPR, SectionHeader, mix, FONT_MONO } from './bento-primitives';
import type { SeerrPaginated, SeerrUserSummary } from '@/types/seerr';

const ROW_HEIGHT = 48;
const USERS_FETCH_SIZE = 50;

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
}

export function RequestsUsersWidget({
  refreshInterval,
  editMode = false,
  hideHeader = false,
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

  if (loading && users.length === 0) {
    return (
      <div ref={ref} style={shellStyle}>
        {header}
        <div style={emptyShellStyle}>
          <span style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</span>
        </div>
      </div>
    );
  }
  if (error && users.length === 0) {
    return (
      <div ref={ref} style={shellStyle}>
        {header}
        <div style={emptyShellStyle}>
          <span style={{ fontSize: 11, color: HPR.rose }}>{error}</span>
        </div>
      </div>
    );
  }
  if (users.length === 0) {
    return (
      <div ref={ref} style={shellStyle}>
        {header}
        <div style={emptyShellStyle}>
          <span style={{ fontSize: 11, color: HPR.fgSubtle }}>No users found</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} style={shellStyle}>
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

const shellStyle = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
} as const;

const emptyShellStyle = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'flex-start',
  padding: '6px 0',
} as const;
