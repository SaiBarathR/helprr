'use client';

import { Children, Fragment, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Loader2, MoreHorizontal, RefreshCw, Rss } from 'lucide-react';
import { toast } from 'sonner';
import {
  ResponsiveMenu,
  ResponsiveMenuActionItem,
  ResponsiveMenuLabel,
  ResponsiveMenuSeparator,
} from '@/components/ui/responsive-menu';
import { withAppName } from '@/components/instance-filter';
import { pollCommand } from '@/lib/arr-command';
import { jsonFetcher } from '@/lib/query-fetch';
import { invalidateMovies, invalidateSeries } from '@/lib/query-invalidation';
import { queryKeys } from '@/lib/query-keys';

type Service = 'sonarr' | 'radarr';

const APP = { sonarr: { type: 'SONARR', name: 'Sonarr' }, radarr: { type: 'RADARR', name: 'Radarr' } } as const;

// What /api/{service}/library-command accepts. A refresh reloads titles from
// TVDB/TMDB, so its completion also reloads the library list.
const COMMANDS: Record<Service, Array<{ name: string; label: string; icon: typeof Rss; refreshesLibrary: boolean }>> = {
  sonarr: [
    { name: 'RssSync', label: 'RSS Sync', icon: Rss, refreshesLibrary: false },
    { name: 'RefreshSeries', label: 'Refresh all series', icon: RefreshCw, refreshesLibrary: true },
  ],
  radarr: [
    { name: 'RssSync', label: 'RSS Sync', icon: Rss, refreshesLibrary: false },
    { name: 'RefreshMovie', label: 'Refresh all movies', icon: RefreshCw, refreshesLibrary: true },
    { name: 'RefreshCollections', label: 'Refresh collections', icon: Layers, refreshesLibrary: true },
  ],
};

/**
 * The library page's ⋯ menu, for admins: the page's own items (`children`),
 * then each instance's library-wide commands. The server checks the admin role;
 * this only keeps the menu from members. Each command names its instance, so
 * with several instances every one gets its own group. `busy` spins the
 * trigger while a page item's work runs.
 */
export function LibraryCommandsMenu({ service, busy, children }: { service: Service; busy?: boolean; children?: ReactNode }) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());
  const { data: instances = [] } = useQuery({
    queryKey: queryKeys.arrInstances(),
    queryFn: jsonFetcher<Array<{ id: string; label: string; type: string }>>('/api/instances'),
    select: (all) => (Array.isArray(all) ? all.filter((c) => c.type === APP[service].type) : []),
  });

  const setKey = (key: string, on: boolean) => setRunning((prev) => {
    const next = new Set(prev);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  });

  async function run(instance: { id: string; label: string }, command: (typeof COMMANDS)[Service][number]) {
    const key = `${instance.id}:${command.name}`;
    // Named only when there is more than one, as the instance filter does.
    const where = instances.length > 1 ? ` on ${withAppName(instance.label, APP[service].type)}` : '';
    setKey(key, true);
    try {
      const res = await fetch(`/api/${service}/library-command?instanceId=${encodeURIComponent(instance.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: command.name }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(`${command.label} failed${where}`, { description: data?.error });
        return;
      }
      const started = (await res.json()) as { id?: number };
      toast.success(`${command.label} started${where}`);
      const status = started.id ? await pollCommand(service, started.id, instance.id) : 'completed';
      if (command.refreshesLibrary && status === 'completed') {
        if (service === 'sonarr') invalidateSeries(queryClient);
        else invalidateMovies(queryClient);
      }
      if (status === 'completed') toast.success(`${command.label} finished${where}`);
      // A whole-library refresh can take minutes; it carries on in the app.
      else if (status === 'timeout') toast(`${command.label} is still running${where}`, { description: `${APP[service].name} carries on with it.` });
      else toast.error(`${command.label} failed${where}`);
    } catch {
      toast.error(`${command.label} failed${where}`);
    } finally {
      setKey(key, false);
    }
  }

  // Children.toArray drops the items a page leaves out (false), so an empty slot adds no separator.
  const hasPageItems = Children.toArray(children).length > 0;
  if (instances.length === 0 && !hasPageItems) return null;

  return (
    <ResponsiveMenu
      title="More actions"
      actions
      align="end"
      trigger={(
        <button
          className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
          aria-label="More actions"
        >
          {/* The menu closes on a pick, so a running command shows here. */}
          {busy || running.size > 0 ? <Loader2 className="h-5 w-5 animate-spin" /> : <MoreHorizontal className="h-5 w-5" />}
        </button>
      )}
    >
      {children}
      {instances.map((instance, index) => (
        <Fragment key={instance.id}>
          {(index > 0 || hasPageItems) && <ResponsiveMenuSeparator />}
          {instances.length > 1 && <ResponsiveMenuLabel>{withAppName(instance.label, APP[service].type)}</ResponsiveMenuLabel>}
          {COMMANDS[service].map((command) => {
            const Icon = command.icon;
            return (
              <ResponsiveMenuActionItem
                key={command.name}
                disabled={running.has(`${instance.id}:${command.name}`)}
                onSelect={() => { void run(instance, command); }}
              >
                <Icon className="h-4 w-4" />
                {command.label}
              </ResponsiveMenuActionItem>
            );
          })}
        </Fragment>
      ))}
    </ResponsiveMenu>
  );
}
