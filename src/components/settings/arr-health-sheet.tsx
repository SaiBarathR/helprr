'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrLogsPanel,
  ArrTasksPanel,
  arrSystemStatusQuery,
  type SystemService,
} from '@/components/settings/arr-system-panels';
import type { ArrLogLevel, ArrSystemStatus } from '@/lib/arr-system';
import { ensureArray, jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import type { HealthService } from '@/lib/arr-health-link';
import type { HealthCheck } from '@/types/arr';
import { cn } from '@/lib/utils';

const HEALTH_ORDER: Record<string, number> = { error: 0, warning: 1, notice: 2 };
const HEALTH_LABEL: Record<string, string> = { error: 'Error', warning: 'Warning', notice: 'Notice' };

/** One instance's health, shared by its Service status row and its sheet. */
export function arrHealthQuery(service: HealthService, instanceId: string) {
  return {
    queryKey: queryKeys.arrHealth(service, instanceId),
    queryFn: jsonFetcher<HealthCheck[]>(`/api/${service}/health`, instanceId),
    select: ensureArray<HealthCheck>,
    staleTime: 60_000,
  };
}

/** The checks worth showing, errors first. */
export function visibleHealthChecks(checks: HealthCheck[] | undefined): HealthCheck[] {
  return (checks ?? [])
    .filter((check) => check.type in HEALTH_ORDER && check.message)
    .sort((a, b) => HEALTH_ORDER[a.type] - HEALTH_ORDER[b.type]);
}

/** "2 health issues", or "No health issues". */
export function healthSummary(checks: HealthCheck[]): string {
  if (checks.length === 0) return 'No health issues';
  return `${checks.length} health issue${checks.length === 1 ? '' : 's'}`;
}

/** Sonarr's check names, readable: "IndexerStatusCheck" → "Indexer Status". */
function sourceLabel(source: string): string {
  return source.replace(/Check$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function HealthChecksList({ checks }: { checks: HealthCheck[] }) {
  return (
    <GroupedSection className="mb-2">
      {checks.map((check, index) => (
        <div key={`${check.source}-${index}`} className="grouped-row grouped-row-stacked gap-1">
          <div className="flex items-center gap-1.5 text-xs">
            <AlertTriangle
              aria-hidden
              className={cn(
                'h-3.5 w-3.5 shrink-0',
                check.type === 'error' ? 'text-rose-400 light:text-rose-600' : 'text-amber-400 light:text-amber-600',
              )}
            />
            <span
              className={cn(
                'font-medium',
                check.type === 'error' ? 'text-rose-400 light:text-rose-600' : 'text-amber-400 light:text-amber-700',
              )}
            >
              {HEALTH_LABEL[check.type]}
            </span>
            {check.source && (
              <span className="min-w-0 truncate text-muted-foreground">· {sourceLabel(check.source)}</span>
            )}
          </div>
          <p className="text-sm [overflow-wrap:anywhere]">{check.message}</p>
          {check.wikiUrl && (
            <a
              href={check.wikiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="-my-2 inline-flex min-h-[44px] items-center gap-1 self-start text-sm text-primary hover:underline"
            >
              Learn more <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </div>
      ))}
    </GroupedSection>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Loading…
    </div>
  );
}

/** "v4.0.20.3014 on main.", and the update it offers. Helprr never installs one. */
function versionText(status: ArrSystemStatus | undefined, isLoading: boolean, appName: string): string {
  if (isLoading) return 'Reading its version…';
  if (!status?.version) return 'Could not read its version. It may be offline.';
  const base = `v${status.version}${status.branch ? ` on ${status.branch}` : ''}.`;
  if (status.updateVersion) return `${base} v${status.updateVersion} is available: update it where ${appName} runs.`;
  return status.updateChecked ? `${base} Up to date.` : `${base} Could not check for updates.`;
}

const APP_NAME: Record<SystemService, string> = { sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr', prowlarr: 'Prowlarr' };

/**
 * One Sonarr, Radarr or Lidarr instance's health checks, as its own System →
 * Status lists them, errors first. Opened from its Service status row or a
 * health push. An admin also gets its version and its System → Tasks and
 * Logs (Prowlarr opens there too, without health, which its own page shows).
 */
export function ArrHealthSheet({
  target,
  open,
  title,
  admin = false,
  onOpenChange,
}: {
  /** Kept after closing, so the sheet doesn't change while it slides away. */
  target: { service: SystemService; instanceId: string } | null;
  open: boolean;
  title: string;
  admin?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const healthService = target && target.service !== 'prowlarr' ? target.service : null;
  const query = useQuery({
    ...arrHealthQuery(healthService ?? 'sonarr', target?.instanceId ?? ''),
    enabled: healthService !== null,
  });
  const system = useQuery({
    ...arrSystemStatusQuery(target?.instanceId ?? ''),
    enabled: admin && target !== null,
  });
  // Kept here, not in the tabs (which unmount when left): runs in progress
  // ("<instance>:<task>") and the log level.
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());
  const [logLevel, setLogLevel] = useState<ArrLogLevel>('warn');
  const checks = visibleHealthChecks(query.data);
  const healthText = query.isLoading
    ? 'Checking…'
    : query.isError
      ? 'Could not read its health. It may be offline.'
      : checks.length === 0
        ? 'No health issues. Everything it checks is working.'
        : `${healthSummary(checks)}, from its System → Status.`;
  const health = query.isLoading ? <Loading /> : checks.length > 0 ? <HealthChecksList checks={checks} /> : null;

  if (!admin || !target) {
    return (
      <Drawer open={open && target !== null} onOpenChange={onOpenChange}>
        <DrawerContent size="content">
          <DrawerHeader>
            <DrawerTitle>{title} health</DrawerTitle>
            <DrawerDescription>{healthText}</DrawerDescription>
          </DrawerHeader>
          <div className="mx-auto w-full max-w-md flex-1 min-h-0 overflow-y-auto px-4">{health}</div>
          <DrawerFooter className="mx-auto w-full max-w-md">
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">Done</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription
            className={cn(system.data?.updateVersion && 'text-amber-300 light:text-amber-700')}
          >
            {versionText(system.data, system.isLoading, APP_NAME[target.service])}
          </DrawerDescription>
        </DrawerHeader>
        {/* Keyed by instance, so another instance opens on its first tab. */}
        <Tabs
          key={target.instanceId}
          defaultValue={healthService ? 'health' : 'tasks'}
          className="mx-auto w-full max-w-md flex-1 min-h-0 gap-0"
        >
          <div className="px-4 pb-3">
            <TabsList variant="segmented">
              {healthService && <TabsTrigger value="health">Health</TabsTrigger>}
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
            </TabsList>
          </div>
          {healthService && (
            <TabsContent value="health" className="min-h-0 overflow-y-auto px-4">
              <p className="mb-3 px-1 text-sm text-muted-foreground">{healthText}</p>
              {health}
            </TabsContent>
          )}
          <TabsContent value="tasks" className="min-h-0 overflow-y-auto px-4">
            <ArrTasksPanel instanceId={target.instanceId} running={running} setRunning={setRunning} />
          </TabsContent>
          <TabsContent value="logs" className="min-h-0 overflow-y-auto px-4">
            <ArrLogsPanel instanceId={target.instanceId} level={logLevel} onLevelChange={setLogLevel} />
          </TabsContent>
        </Tabs>
        <DrawerFooter className="mx-auto w-full max-w-md">
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">Done</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
