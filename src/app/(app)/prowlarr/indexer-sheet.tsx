'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle, Loader2, Minus, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { fmtNum } from '@/components/widgets/prowlarr-stats-shared';
import { ensureArray, jsonFetcher } from '@/lib/query-fetch';
import {
  getProwlarrIndexerStatusId,
  isProwlarrIndexerBlocked,
  type ProwlarrAppProfile,
  type ProwlarrHistoryResponse,
  type ProwlarrIndexerStatus,
  type ProwlarrIndexerSummary,
} from '@/lib/prowlarr-client';
import { prowlarrStatsQuery } from './prowlarr-stats-query';
import type { IndexerActions } from './use-indexer-actions';
import type { Tag } from '@/types/arr';

/**
 * Format an ISO date-time string into a locale-aware date and time representation.
 *
 * @param iso - An ISO 8601 date-time string (e.g., "2023-08-15T13:45:30Z")
 * @returns The input date formatted using the runtime's locale and conventions
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function getActiveBlockedStatus(indexerId: number, statuses: ProwlarrIndexerStatus[]): ProwlarrIndexerStatus | undefined {
  return statuses.find((status) => (
    getProwlarrIndexerStatusId(status) === indexerId && isProwlarrIndexerBlocked(status)
  ));
}

export function BlockedStatusDetails({ status }: { status: ProwlarrIndexerStatus }) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium text-foreground">Indexer temporarily blocked</p>
      </div>
      <div className="space-y-2 text-xs">
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Initial failure</span>
          <span className="text-right text-foreground">{status.initialFailure ? formatDate(status.initialFailure) : '-'}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Last failure</span>
          <span className="text-right text-foreground">{status.mostRecentFailure ? formatDate(status.mostRecentFailure) : '-'}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Disabled until</span>
          <span className="text-right text-foreground">{status.disabledTill ? formatDate(status.disabledTill) : '-'}</span>
        </div>
      </div>
    </div>
  );
}

const MIN_PRIORITY = 1;
const MAX_PRIORITY = 50;

const HISTORY_EVENT_LABELS: Record<string, string> = {
  indexerQuery: 'Search',
  indexerRss: 'RSS',
  releaseGrabbed: 'Grab',
  indexerAuth: 'Auth',
  indexerInfo: 'Info',
};

/**
 * Priority, app profile and tags. Each change saves on its own; nothing here
 * opens the keyboard, which would push the drawer off screen on iOS. Users who
 * cannot manage see the same values as plain text.
 */
function IndexerQuickEdit({
  indexer,
  canManage,
  actions,
  open,
}: {
  indexer: ProwlarrIndexerSummary;
  canManage: boolean;
  actions: IndexerActions;
  open: boolean;
}) {
  const profilesQuery = useQuery({
    queryKey: ['prowlarr', 'appprofile'],
    queryFn: jsonFetcher<ProwlarrAppProfile[]>('/api/prowlarr/appprofile'),
    select: ensureArray,
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const tagsQuery = useQuery({
    queryKey: ['prowlarr', 'tags'],
    queryFn: jsonFetcher<Tag[]>('/api/prowlarr/tags'),
    select: ensureArray,
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const profiles = profilesQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const pending = actions.pendingEdits.has(indexer.id);
  const profileName = profiles.find((profile) => profile.id === indexer.appProfileId)?.name;
  const visibleTags = canManage ? tags : tags.filter((tag) => indexer.tags.includes(tag.id));

  function changePriority(priority: number) {
    void actions.handleEdit(indexer, { priority }, `Could not change the priority of ${indexer.name}`);
  }

  function changeProfile(value: string) {
    const appProfileId = Number(value);
    if (appProfileId === indexer.appProfileId) return;
    void actions.handleEdit(indexer, { appProfileId }, `Could not change the app profile of ${indexer.name}`);
  }

  function toggleTag(tag: Tag) {
    const assigned = indexer.tags.includes(tag.id);
    void actions.handleEdit(
      indexer,
      { tags: assigned ? indexer.tags.filter((id) => id !== tag.id) : [...indexer.tags, tag.id] },
      `Could not change the tags of ${indexer.name}`,
      // One tag at a time, so a tag added elsewhere in the meantime is kept.
      { tags: [tag.id], applyTags: assigned ? 'remove' : 'add' },
    );
  }

  return (
    <section aria-label="Settings" className="rounded-lg bg-muted/30 divide-y divide-border/40">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="text-sm">Priority</span>
        {canManage ? (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label="Lower the priority number"
              disabled={pending || indexer.priority <= MIN_PRIORITY}
              onClick={() => changePriority(indexer.priority - 1)}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-9 text-center text-sm font-semibold tabular-nums" aria-live="polite">{indexer.priority}</span>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label="Raise the priority number"
              disabled={pending || indexer.priority >= MAX_PRIORITY}
              onClick={() => changePriority(indexer.priority + 1)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <span className="text-sm tabular-nums">{indexer.priority}</span>
        )}
      </div>
      {(canManage || profileName) && (
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="text-sm">App profile</span>
          {canManage && profiles.length > 0 ? (
            <Select value={String(indexer.appProfileId ?? '')} onValueChange={changeProfile} disabled={pending}>
              <SelectTrigger size="sm" aria-label="App profile" className="min-w-0 max-w-[60%]">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={String(profile.id)}>{profile.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-sm text-muted-foreground">{profileName ?? '—'}</span>
          )}
        </div>
      )}
      {visibleTags.length > 0 && (
        <div className="px-3 py-2">
          <p className="text-sm">Tags</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {visibleTags.map((tag) => {
              const assigned = indexer.tags.includes(tag.id);
              return canManage ? (
                <Button
                  key={tag.id}
                  variant={assigned ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 px-2.5 text-xs"
                  aria-pressed={assigned}
                  disabled={pending}
                  onClick={() => toggleTag(tag)}
                >
                  {tag.label}
                </Button>
              ) : (
                <Badge key={tag.id} variant="outline">{tag.label}</Badge>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function IndexerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Everything about one indexer in one place: why it is blocked and until when,
 * its numbers for the last 7 days, its last searches and grabs, its categories,
 * and the Test, enable and Delete actions for users who can manage.
 *
 * @param indexer - The indexer to show; when `null` the drawer is closed.
 * @param statuses - Indexer statuses, already fetched for the list.
 * @param canManage - Whether the actions are shown; the routes enforce it too.
 * @param actions - Shared row actions.
 * @param onClose - Called when the drawer is dismissed.
 */
export function IndexerSheet({
  indexer,
  statuses,
  canManage,
  actions,
  onClose,
}: {
  indexer: ProwlarrIndexerSummary | null;
  statuses: ProwlarrIndexerStatus[];
  canManage: boolean;
  actions: IndexerActions;
  onClose: () => void;
}) {
  const open = !!indexer;
  const indexerId = indexer?.id;

  const statsQuery = useQuery({ ...prowlarrStatsQuery('7d'), enabled: open });
  const historyQuery = useQuery({
    queryKey: ['prowlarr', 'indexer-history', indexerId],
    queryFn: jsonFetcher<ProwlarrHistoryResponse>(`/api/prowlarr/history?indexerId=${indexerId}&pageSize=10`),
    enabled: open,
    staleTime: 30_000,
  });

  const stats = statsQuery.data?.indexers?.find((row) => row.indexerId === indexerId);
  const blockedStatus = indexer ? getActiveBlockedStatus(indexer.id, statuses) : undefined;
  const records = historyQuery.data?.records ?? [];
  const pending = indexer ? actions.pendingEdits.has(indexer.id) : false;

  return (
    <Drawer open={open} autoFocus onOpenChange={(next) => { if (!next) onClose(); }}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-base leading-snug [overflow-wrap:anywhere]">
            {indexer?.name ?? 'Indexer'}
          </DrawerTitle>
          <DrawerDescription>
            {indexer ? [indexer.implementationName, indexer.protocol, indexer.privacy].filter(Boolean).join(' · ') : ''}
          </DrawerDescription>
        </DrawerHeader>
        {indexer && (
          <div className="px-4 pb-8 flex-1 min-h-0 overflow-y-auto space-y-4">
            {canManage && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={indexer.enable}
                    onCheckedChange={(enable) => void actions.handleToggle(indexer, enable)}
                    disabled={pending}
                    aria-label={`${indexer.name} enabled`}
                  />
                  {indexer.enable ? 'Enabled' : 'Disabled'}
                </label>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => void actions.handleTest(indexer.id)}
                    disabled={actions.testingId === indexer.id}
                  >
                    {actions.testingId === indexer.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <CheckCircle className="h-4 w-4" />}
                    Test
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 text-rose-400"
                    aria-label={`Delete ${indexer.name}`}
                    onClick={() => actions.setConfirmDelete({ id: indexer.id, name: indexer.name })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {blockedStatus && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">
                <BlockedStatusDetails status={blockedStatus} />
              </div>
            )}

            <IndexerQuickEdit indexer={indexer} canManage={canManage} actions={actions} open={open} />

            <section aria-label="Last 7 days">
              <p className="mb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Last 7 days</p>
              {stats ? (
                <div className="grid grid-cols-2 gap-2">
                  <IndexerStat label="Queries" value={fmtNum(stats.numberOfQueries + stats.numberOfRssQueries + stats.numberOfAuthQueries)} />
                  <IndexerStat label="Grabs" value={fmtNum(stats.numberOfGrabs)} />
                  <IndexerStat label="Failed" value={fmtNum(stats.numberOfFailedQueries + stats.numberOfFailedRssQueries)} />
                  <IndexerStat label="Avg response" value={`${fmtNum(Math.round(stats.averageResponseTime))} ms`} />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {statsQuery.isLoading ? 'Loading…' : 'No activity in the last 7 days.'}
                </p>
              )}
            </section>

            <section aria-label="Recent activity">
              <p className="mb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Recent activity</p>
              {records.length > 0 ? (
                <div className="rounded-lg bg-muted/30 overflow-hidden divide-y divide-border/40">
                  {records.map((record) => (
                    <div key={record.id} className="flex items-center gap-2 px-3 py-2 text-[11px]">
                      <span className="w-10 shrink-0 text-muted-foreground">
                        {HISTORY_EVENT_LABELS[record.eventType] ?? record.eventType}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{record.data?.query || record.data?.source || '—'}</span>
                      {record.successful === false && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-rose-500/40 text-rose-400">Failed</Badge>
                      )}
                      <span className="shrink-0 text-muted-foreground">
                        {new Date(record.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {historyQuery.isLoading ? 'Loading…' : 'No recent activity.'}
                </p>
              )}
            </section>

            {indexer.categories.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  Categories ({indexer.categories.length})
                </summary>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {indexer.categories.map((category) => (
                    <Badge key={category} variant="outline" className="text-[10px] px-1.5 py-0">{category}</Badge>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
