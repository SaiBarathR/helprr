'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { GroupedSection } from '@/components/settings/grouped-section';
import { jsonFetcher } from '@/lib/query-fetch';
import { invalidateInstances } from '@/lib/query-invalidation';
import { findServiceByType } from '@/lib/settings/service-config';
import type { ImportCandidate, ImportDiscovery, ImportResult } from '@/lib/service-import';

interface RowState {
  selected: boolean;
  label: string;
  url: string;
  apiKey: string;
}

/** The same address, however it is typed (case, a trailing slash, a default port). */
function sameAddress(a: string, b: string): boolean {
  const normal = (value: string) => {
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim()) ? value.trim() : `http://${value.trim()}`);
      return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      return value.trim();
    }
  };
  return normal(a) === normal(b);
}

const SOURCE_LABEL = { seerr: 'Seerr', prowlarr: 'Prowlarr' } as const;

function initialRow(candidate: ImportCandidate): RowState {
  // Seerr's apps can import as they are; Prowlarr's need a key typed in first.
  return { selected: !candidate.needsKey && candidate.reachable, label: candidate.name, url: candidate.url, apiKey: '' };
}

/**
 * "Found in Seerr and Prowlarr": the Sonarr, Radarr and Lidarr servers those apps know
 * about and Helprr does not have yet, added in one go. Admins only (the page checks).
 */
export function ImportFoundApps() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['services', 'import'],
    queryFn: jsonFetcher<ImportDiscovery>('/api/services/import'),
    staleTime: 60_000,
  });
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [results, setResults] = useState<Record<string, ImportResult>>({});

  const candidates = (data?.candidates ?? []).filter((candidate) => !candidate.connected && !results[candidate.id]?.ok);
  const row = (candidate: ImportCandidate) => rows[candidate.id] ?? initialRow(candidate);
  const update = (candidate: ImportCandidate, change: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [candidate.id]: { ...row(candidate), ...change } }));
  // A Seerr key belongs to Seerr's address; another address needs a key typed in.
  const needsKey = (candidate: ImportCandidate) => candidate.needsKey || !sameAddress(row(candidate).url, candidate.url);
  const chosen = candidates.filter((candidate) => row(candidate).selected);
  const missingKey = chosen.some(
    (candidate) => (needsKey(candidate) && !row(candidate).apiKey.trim()) || !row(candidate).label.trim(),
  );

  const add = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/services/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: chosen.map((candidate) => ({
            id: candidate.id,
            label: row(candidate).label,
            url: row(candidate).url,
            apiKey: needsKey(candidate) ? row(candidate).apiKey : undefined,
          })),
        }),
      });
      if (!res.ok) throw new Error('Could not add the apps.');
      return (await res.json()) as { results: ImportResult[] };
    },
    onSuccess: ({ results: done }) => {
      setResults((prev) => ({ ...prev, ...Object.fromEntries(done.map((result) => [result.id, result])) }));
      const added = done.filter((result) => result.ok).length;
      if (added) {
        toast.success(`Added ${added} ${added === 1 ? 'app' : 'apps'}`);
        invalidateInstances(queryClient);
        // Apps now connected drop off the list, including the same app from the other source.
        void queryClient.invalidateQueries({ queryKey: ['services', 'import'] });
      }
      if (added < done.length) toast.error('Some apps were not added. See below.');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not add the apps.'),
  });

  if (candidates.length === 0) return null;
  const sources = [...new Set(candidates.map((candidate) => SOURCE_LABEL[candidate.source]))].join(' and ');

  return (
    <GroupedSection
      title={`Found in ${sources}`}
      footer="Helprr tests each app before adding it. Keys stay on the server."
    >
      <ul className="divide-y divide-border/50">
        {candidates.map((candidate) => {
          const config = findServiceByType(candidate.type);
          const Icon = config?.icon;
          const state = row(candidate);
          const result = results[candidate.id];
          const id = `import-${candidate.id.replace(/[^a-z0-9]/gi, '-')}`;
          return (
            <li key={candidate.id} className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-3">
                <Checkbox
                  id={id}
                  checked={state.selected}
                  onCheckedChange={(checked) => update(candidate, { selected: checked === true })}
                  aria-label={`Add ${candidate.name}`}
                />
                {Icon && (
                  <span className={`flex h-8 w-8 items-center justify-center rounded-md shrink-0 ${config.iconBg} ${config.iconColor}`}>
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                )}
                <label htmlFor={id} className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium truncate">{candidate.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {config?.label ?? candidate.type} · from {SOURCE_LABEL[candidate.source]}
                  </span>
                </label>
                <span className={`text-[11px] shrink-0 ${candidate.reachable ? 'text-emerald-500' : 'text-orange-700 dark:text-orange-400'}`}>
                  {candidate.reachable ? 'answers' : 'no answer'}
                </span>
              </div>
              {state.selected && (
                <div className="pl-7 space-y-2">
                  <Input
                    value={state.label}
                    onChange={(event) => update(candidate, { label: event.target.value })}
                    aria-label={`${candidate.name} name in Helprr`}
                    placeholder="Name in Helprr"
                    className="h-9 text-sm"
                  />
                  <Input
                    value={state.url}
                    onChange={(event) => update(candidate, { url: event.target.value })}
                    aria-label={`${candidate.name} address`}
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="h-9 font-mono text-xs"
                  />
                  {!candidate.reachable && (
                    <p className="text-xs text-muted-foreground">
                      {SOURCE_LABEL[candidate.source]} reaches it at this address, but Helprr does not. Enter the address
                      Helprr can use, such as this computer&apos;s address on your network.
                    </p>
                  )}
                  {needsKey(candidate) && (
                    <Input
                      value={state.apiKey}
                      onChange={(event) => update(candidate, { apiKey: event.target.value })}
                      aria-label={`${candidate.name} API key`}
                      placeholder="API key (Settings → General in the app)"
                      type="password"
                      autoComplete="off"
                      className="h-9 font-mono text-xs"
                    />
                  )}
                </div>
              )}
              {result && !result.ok && <p className="pl-7 text-xs text-red-400" role="alert">{result.error}</p>}
            </li>
          );
        })}
      </ul>
      <div className="px-4 py-3">
        <Button className="w-full h-9" onClick={() => add.mutate()} disabled={chosen.length === 0 || missingKey || add.isPending}>
          {add.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {chosen.length ? `Test and add ${chosen.length} ${chosen.length === 1 ? 'app' : 'apps'}` : 'Choose apps to add'}
        </Button>
      </div>
    </GroupedSection>
  );
}
