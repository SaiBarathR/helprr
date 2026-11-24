'use client';

import Link from '@/components/ui/app-link';
import { useLayoutEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError, ensureArray, jsonFetcher } from '@/lib/query-fetch';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { GroupedSection } from '@/components/settings/grouped-section';
import { PollingHealthSection } from '@/components/settings/polling-health-section';
import { ArrHealthSheet, arrHealthQuery, healthSummary, visibleHealthChecks } from '@/components/settings/arr-health-sheet';
import { cn } from '@/lib/utils';
import { hasCapability, useMe, type MePayload } from '@/components/permission-provider';
import { parseArrHealthLink, type HealthService } from '@/lib/arr-health-link';
import { useAppSettings } from '@/lib/hooks/use-app-settings';
import type { UpdateCheckResult } from '@/lib/update-check';
import type { SecretsStatus } from '@/lib/generated-secrets';
import { APP_VERSION, GIT_SHA } from '@/lib/app-version';

interface ServiceHealthStatus {
  instanceId: string;
  type: string;
  name: string;
  label: string;
  ok: boolean;
  error?: string;
}

const HEALTH_SERVICE: Partial<Record<string, HealthService>> = { SONARR: 'sonarr', RADARR: 'radarr', LIDARR: 'lidarr' };
const SERVICE_NAME: Record<HealthService, string> = { sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr' };

// Who may read an instance's health: as for its push, notify.health (and
// music.view for Lidarr). The health routes check the same.
function canReadHealth(me: MePayload | null, service: HealthService): boolean {
  return hasCapability(me, 'notify.health') && (service !== 'lidarr' || hasCapability(me, 'music.view'));
}

export default function ServiceStatusPage() {
  const me = useMe();
  const isAdmin = me?.role === 'admin';
  const queryClient = useQueryClient();
  const { settings, update: updateSettings } = useAppSettings();
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
  const { data: secrets = null } = useQuery({
    queryKey: ['admin', 'secrets'],
    queryFn: jsonFetcher<SecretsStatus>('/api/admin/secrets'),
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  });
  // The Sonarr/Radarr/Lidarr instances that are up and whose health this user may read.
  const healthRows = statuses.flatMap((s) => {
    const service = HEALTH_SERVICE[s.type];
    return service && s.ok && canReadHealth(me, service) ? [{ service, instanceId: s.instanceId }] : [];
  });
  const healthQueries = useQueries({ queries: healthRows.map((row) => arrHealthQuery(row.service, row.instanceId)) });
  const healthByInstance = new Map(healthRows.map((row, index) => [row.instanceId, healthQueries[index]]));
  const refreshing = (isFetching && !loading) || healthQueries.some((q) => q.isFetching && !q.isLoading);

  // The open health sheet: a row tapped, or a health push's link
  // (?health=sonarr&instance=<id>), handled once per link.
  const searchParams = useSearchParams();
  const link = parseArrHealthLink(searchParams);
  const linkKey = link ? `${link.service}:${link.instanceId}` : null;
  const [handledLink, setHandledLink] = useState<string | null>(null);
  const [healthTarget, setHealthTarget] = useState<{ service: HealthService; instanceId: string } | null>(null);
  const [healthOpen, setHealthOpen] = useState(false);
  if (link && linkKey !== handledLink && me) {
    setHandledLink(linkKey);
    if (canReadHealth(me, link.service)) {
      setHealthTarget(link);
      setHealthOpen(true);
    }
  } else if (!link && handledLink) {
    setHandledLink(null);
  }
  // Drop a handled link from the URL, so Back to this page or a reload doesn't
  // open the sheet again. A layout effect, so it runs before the sheet's own
  // history entry is pushed (a passive effect) and edits this page's entry,
  // not the sheet's. The router's state is kept so Back here doesn't reload.
  useLayoutEffect(() => {
    if (!handledLink) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('health') === null) return;
    params.delete('health');
    params.delete('instance');
    const query = params.toString();
    window.history.replaceState(window.history.state, '', query ? `/settings/status?${query}` : '/settings/status');
  }, [handledLink]);
  const targetStatus = healthTarget ? statuses.find((s) => s.instanceId === healthTarget.instanceId) : undefined;
  // Once the instance is listed, its own type decides the service: a hand-made
  // link naming the wrong one shows that instance's real health (or nothing,
  // for an instance with none), never one service's title over another's.
  const targetService = targetStatus ? HEALTH_SERVICE[targetStatus.type] : healthTarget?.service;
  const sheetTarget = healthTarget && targetService && canReadHealth(me, targetService)
    ? { service: targetService, instanceId: healthTarget.instanceId }
    : null;
  const healthTitle = !sheetTarget
    ? ''
    : targetStatus && targetStatus.label && targetStatus.label !== targetStatus.name
      ? `${targetStatus.name} · ${targetStatus.label}`
      : SERVICE_NAME[sheetTarget.service];

  function handleRefresh() {
    void refetch();
    for (const q of healthQueries) void q.refetch();
  }

  const downCount = statuses.filter((s) => !s.ok).length;

  async function setUpdateCheck(enabled: boolean) {
    if (await updateSettings({ updateCheckEnabled: enabled })) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminUpdate() });
    }
  }

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
          {statuses.map((s) => {
            const health = healthByInstance.get(s.instanceId);
            const checks = health?.data ? visibleHealthChecks(health.data) : null;
            const content = (
              <>
                <div className="min-w-0 flex-1 pr-3 text-left">
                  <div className="text-sm font-medium">
                    {s.name}
                    {s.label && s.label !== s.name && (
                      <span className="text-muted-foreground font-normal"> · {s.label}</span>
                    )}
                  </div>
                  {!s.ok && s.error && (
                    <div className="text-xs text-red-400/90 light:text-red-600 mt-0.5 break-words">{s.error}</div>
                  )}
                  {health && (
                    <div
                      className={cn(
                        'text-xs mt-0.5',
                        checks && checks.some((c) => c.type === 'error')
                          ? 'text-rose-400 light:text-rose-600'
                          : checks && checks.length > 0
                            ? 'text-amber-400 light:text-amber-700'
                            : 'text-muted-foreground',
                      )}
                    >
                      {checks ? healthSummary(checks) : health.isError ? 'Health unavailable' : 'Checking health…'}
                    </div>
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
                  {health && <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
                </div>
              </>
            );
            const service = HEALTH_SERVICE[s.type];
            return health && service ? (
              <button
                key={s.instanceId}
                type="button"
                className="grouped-row w-full items-start active:bg-foreground/5 transition-colors"
                onClick={() => {
                  setHealthTarget({ service, instanceId: s.instanceId });
                  setHealthOpen(true);
                }}
              >
                {content}
              </button>
            ) : (
              <div key={s.instanceId} className="grouped-row items-start">
                {content}
              </div>
            );
          })}
        </GroupedSection>
      )}

      <ArrHealthSheet target={sheetTarget} open={healthOpen} title={healthTitle} onOpenChange={setHealthOpen} />

      {isAdmin && (
        <div className="mt-6">
          <PollingHealthSection />
        </div>
      )}

      {isAdmin && secrets && (
        <div className="mt-6">
          <GroupedSection title="Secrets" footer="Where they come from, never their values. Made by Helprr means the helprr-secrets volume: back it up with the database.">
            {secrets.lostSecret && (
              <div className="grouped-row items-start bg-amber-500/[0.06]" role="alert">
                <div className="min-w-0 flex-1 text-xs text-amber-300 light:text-amber-700">
                  The session secret is newer than some accounts, so the one before it was lost (the
                  helprr-secrets volume was removed or replaced). Stored service sign-ins cannot be read and
                  everyone had to sign in again. Restore the volume from a backup to undo this.
                </div>
              </div>
            )}
            <div className="grouped-row">
              <div className="min-w-0 flex-1 text-sm">Session secret</div>
              <div className="shrink-0 text-sm text-muted-foreground">
                {secrets.sessionSecret === 'generated' ? 'Made by Helprr' : 'From .env'}
              </div>
            </div>
            <div className="grouped-row">
              <div className="min-w-0 flex-1 text-sm">Push notification keys</div>
              <div className="shrink-0 text-sm text-muted-foreground">
                {secrets.pushKeys === 'generated' ? 'Made by Helprr' : secrets.pushKeys === 'env' ? 'From .env' : 'Not set'}
              </div>
            </div>
          </GroupedSection>
        </div>
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
              {isAdmin && updateCheck?.status === 'disabled' && (
                <div className="mt-0.5 text-xs text-muted-foreground">Update check off</div>
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
                <div className="text-sm font-medium">Check for updates</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Asks GitHub for a new Helprr release every six hours and tells admins once. Off, Helprr never asks.
                </div>
              </div>
              <Switch
                aria-label="Check for updates"
                checked={settings?.updateCheckEnabled ?? true}
                onCheckedChange={(next) => void setUpdateCheck(next)}
                disabled={!settings}
              />
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
