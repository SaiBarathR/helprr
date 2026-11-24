'use client';

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
import { ensureArray, jsonFetcher } from '@/lib/query-fetch';
import type { HealthService } from '@/lib/arr-health-link';
import type { HealthCheck } from '@/types/arr';
import { cn } from '@/lib/utils';

const HEALTH_ORDER: Record<string, number> = { error: 0, warning: 1, notice: 2 };
const HEALTH_LABEL: Record<string, string> = { error: 'Error', warning: 'Warning', notice: 'Notice' };

/** One instance's health, shared by its Service status row and its sheet. */
export function arrHealthQuery(service: HealthService, instanceId: string) {
  return {
    queryKey: ['arr-health', service, instanceId],
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

/**
 * The health checks of one Sonarr, Radarr or Lidarr instance, as its own
 * System → Status lists them, errors first. Opened from its Service status row
 * or a health push.
 */
export function ArrHealthSheet({
  target,
  open,
  title,
  onOpenChange,
}: {
  /** Kept after closing, so the sheet doesn't change while it slides away. */
  target: { service: HealthService; instanceId: string } | null;
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
}) {
  const query = useQuery({
    ...arrHealthQuery(target?.service ?? 'sonarr', target?.instanceId ?? ''),
    enabled: target !== null,
  });
  const checks = visibleHealthChecks(query.data);

  return (
    <Drawer open={open && target !== null} onOpenChange={onOpenChange}>
      <DrawerContent size="content">
        <DrawerHeader>
          <DrawerTitle>{title} health</DrawerTitle>
          <DrawerDescription>
            {query.isLoading
              ? 'Checking…'
              : query.isError
                ? 'Could not read its health. It may be offline.'
                : checks.length === 0
                  ? 'No health issues. Everything it checks is working.'
                  : `${healthSummary(checks)}, from its System → Status.`}
          </DrawerDescription>
        </DrawerHeader>
        <div className="mx-auto w-full max-w-md flex-1 min-h-0 overflow-y-auto px-4">
          {query.isLoading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : checks.length > 0 ? (
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
          ) : null}
        </div>
        <DrawerFooter className="mx-auto w-full max-w-md">
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">Done</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
