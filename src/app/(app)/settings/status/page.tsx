'use client';

import Link from 'next/link';
import { ChevronLeft, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError, ensureArray, jsonFetcher } from '@/lib/query-fetch';
import { Button } from '@/components/ui/button';
import { GroupedSection } from '@/components/settings/grouped-section';
import { cn } from '@/lib/utils';
import { useMe } from '@/components/permission-provider';
import type { UpdateCheckResult } from '@/lib/update-check';

// Inlined at build time (see next.config.ts `env`) — identifies the running build.
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'unknown';
const GIT_SHA = process.env.NEXT_PUBLIC_GIT_SHA || '';

interface ServiceHealthStatus {
  instanceId: string;
  type: string;
  name: string;
  label: string;
  ok: boolean;
  error?: string;
}

export default function ServiceStatusPage() {
  const me = useMe();
  const isAdmin = me?.role === 'admin';
  const {
    data: statuses = [],
    isLoading: loading,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.health(),
    // The health route is Cache-Control: max-age=60, so a plain GET (jsonFetcher)
    // could serve a stale snapshot to "Re-test". Force a live probe with no-store.
    queryFn: async ({ signal }): Promise<ServiceHealthStatus[]> => {
      const res = await fetch('/api/services/health', { cache: 'no-store', signal });
      if (!res.ok) throw new ApiError(res.status, `GET /api/services/health → ${res.status}`);
      return (await res.json()) as ServiceHealthStatus[];
    },
    select: ensureArray,
  });
  const {
    data: updateCheck = null,
    isFetching: checkingUpdate,
    refetch: recheckUpdate,
  } = useQuery({
    queryKey: queryKeys.adminUpdate(),
    queryFn: jsonFetcher<UpdateCheckResult>('/api/admin/update-check'),
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  });
  const refreshing = isFetching && !loading;

  function handleRefresh() {
    void refetch();
  }

  const downCount = statuses.filter((s) => !s.ok).length;

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Settings
        </Link>
      </div>

      <div className="px-4 mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Service status</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {loading
              ? 'Checking connected services…'
              : isError
                ? 'Could not check service status'
                : downCount > 0
                  ? `${downCount} service${downCount === 1 ? '' : 's'} unreachable`
                  : 'All connected services are reachable'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading} className="h-9 shrink-0">
          {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Re-test
        </Button>
      </div>

      {loading ? (
        <GroupedSection>
          <div className="px-4 py-8 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        </GroupedSection>
      ) : isError ? (
        <GroupedSection>
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            Could not check service status. Tap Re-test to try again.
          </div>
        </GroupedSection>
      ) : statuses.length === 0 ? (
        <GroupedSection>
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No services to show.
          </div>
        </GroupedSection>
      ) : (
        <GroupedSection>
          {statuses.map((s) => (
            <div key={s.instanceId} className="grouped-row items-start">
              <div className="min-w-0 flex-1 pr-3">
                <div className="text-sm font-medium">
                  {s.name}
                  {s.label && s.label !== s.name && (
                    <span className="text-muted-foreground font-normal"> · {s.label}</span>
                  )}
                </div>
                {!s.ok && s.error && (
                  <div className="text-xs text-red-400/90 light:text-red-600 mt-0.5 break-words">{s.error}</div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={cn('h-2 w-2 rounded-full', s.ok ? 'bg-emerald-500' : 'bg-red-500')}
                  aria-hidden
                />
                <span
                  className={cn(
                    'text-xs font-medium',
                    s.ok ? 'text-emerald-400 light:text-emerald-700' : 'text-red-400 light:text-red-600',
                  )}
                >
                  {s.ok ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
          ))}
        </GroupedSection>
      )}

      <div className="mt-6">
        <GroupedSection>
          <div className="grouped-row items-start">
            <div className="min-w-0 flex-1 pr-3">
              <div className="text-sm font-medium">Helprr</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Include this version when reporting an issue.
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm">{APP_VERSION}</div>
              {GIT_SHA && (
                <div className="text-xs text-muted-foreground font-mono">{GIT_SHA.slice(0, 7)}</div>
              )}
              {isAdmin && updateCheck?.status === 'up_to_date' && (
                <div className="mt-0.5 text-xs text-emerald-400 light:text-emerald-700">Up to date</div>
              )}
              {isAdmin && updateCheck?.status === 'development' && (
                <div className="mt-0.5 text-xs text-muted-foreground">Development build</div>
              )}
              {isAdmin && updateCheck?.status === 'unavailable' && (
                <div className="mt-0.5 text-xs text-muted-foreground">Check unavailable</div>
              )}
            </div>
          </div>
          {isAdmin && updateCheck?.status === 'update_available' && updateCheck.latestVersion && (
            <div className="grouped-row items-start bg-amber-500/[0.06]">
              <div className="min-w-0 flex-1 pr-3">
                <div className="text-sm font-medium text-amber-300 light:text-amber-700">
                  Helprr {updateCheck.latestVersion} is available
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Review the release notes, then follow the documented backup and update steps.
                </div>
              </div>
              {updateCheck.releaseUrl && (
                <Button asChild variant="outline" size="sm" className="shrink-0">
                  <a href={updateCheck.releaseUrl} target="_blank" rel="noreferrer">
                    Release <ExternalLink />
                  </a>
                </Button>
              )}
            </div>
          )}
          {isAdmin && updateCheck?.status === 'unavailable' && (
            <div className="grouped-row items-center">
              <div className="min-w-0 flex-1 pr-3 text-xs text-muted-foreground">
                GitHub could not be checked. This does not affect Helprr or connected services.
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={checkingUpdate}
                onClick={() => void recheckUpdate()}
              >
                {checkingUpdate && <Loader2 className="animate-spin" />}
                Check again
              </Button>
            </div>
          )}
          {isAdmin && (
            <div className="grouped-row items-center">
              <div className="min-w-0 flex-1 pr-3">
                <div className="text-sm font-medium">Support bundle</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Download redacted diagnostics and recent logs for troubleshooting.
                </div>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <a href="/api/admin/support-bundle">
                  <Download /> Download
                </a>
              </Button>
            </div>
          )}
        </GroupedSection>
      </div>
    </div>
  );
}
