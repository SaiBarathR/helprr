'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { jsonFetcher, ensureArray } from '@/lib/query-fetch';
import { isProwlarrTestAllResponse } from '@/lib/prowlarr-client';
import type { ProwlarrIndexerProxySummary } from '@/lib/prowlarr-proxies';
import { prowlarrTagsQuery } from './prowlarr-tags-query';

type TestResult = 'passed' | 'failed';

function usedBy(proxy: ProwlarrIndexerProxySummary): string {
  if (proxy.tags.length === 0) return 'Not used: Prowlarr uses a proxy only for indexers that share one of its tags';
  if (proxy.indexers.length === 0) return 'No indexer has its tags';
  return `Used by ${proxy.indexers.map((indexer) => indexer.name).join(', ')}`;
}

/**
 * Prowlarr's indexer proxies (FlareSolverr, HTTP, SOCKS), the indexers each
 * one serves, and Test. A proxy that is down otherwise shows only as a health
 * warning. Its address and login stay on the server.
 */
export function IndexerProxiesSection({ canManage }: { canManage: boolean }) {
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  // The last result per proxy, shown until the page is left.
  const [results, setResults] = useState<Record<number, TestResult>>({});
  const query = useQuery({
    queryKey: ['prowlarr', 'indexerproxies'],
    queryFn: jsonFetcher<ProwlarrIndexerProxySummary[]>('/api/prowlarr/indexerproxies'),
    select: ensureArray,
    staleTime: 60_000,
  });
  const tagsQuery = useQuery(prowlarrTagsQuery);
  const proxies = query.data ?? [];
  const tagLabels = new Map((tagsQuery.data ?? []).map((tag) => [tag.id, tag.label]));

  async function test(proxy: ProwlarrIndexerProxySummary) {
    setTestingId(proxy.id);
    try {
      const res = await fetch(`/api/prowlarr/indexerproxies/${proxy.id}/test`, { method: 'POST' });
      setResults((prev) => ({ ...prev, [proxy.id]: res.ok ? 'passed' : 'failed' }));
      if (res.ok) toast.success(`${proxy.name} test passed`);
      else toast.error(`${proxy.name} test failed`, { description: 'Prowlarr’s System → Logs say why.' });
    } catch {
      toast.error(`${proxy.name} test failed`);
    } finally {
      setTestingId(null);
    }
  }

  async function testAll() {
    setTestingAll(true);
    try {
      const res = await fetch('/api/prowlarr/indexerproxies/testall', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !isProwlarrTestAllResponse(data)) {
        toast.error('Test All failed');
        return;
      }
      setResults((prev) => ({
        ...prev,
        ...Object.fromEntries(data.results.map((result) => [result.id, result.isValid ? 'passed' : 'failed'])),
      }));
      if (data.hasFailures) {
        const names = new Map(proxies.map((proxy) => [proxy.id, proxy.name]));
        const failed = data.results.filter((result) => !result.isValid).map((result) => names.get(result.id) ?? `Proxy ${result.id}`);
        toast.error(`${data.passed} passed, ${data.failed} failed`, { description: failed.join(', ') });
      } else {
        toast.success('All proxies passed');
      }
    } catch {
      toast.error('Test All failed');
    } finally {
      setTestingAll(false);
    }
  }

  return (
    <section aria-label="Indexer proxies" className="space-y-2 pt-3">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <h2 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Indexer proxies</h2>
        {canManage && proxies.length > 1 && (
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={testAll} disabled={testingAll}>
            {testingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            Test All
          </Button>
        )}
      </div>
      {query.isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : query.isError ? (
        <div className="rounded-xl bg-card p-4 text-center text-sm text-muted-foreground">Failed to load indexer proxies</div>
      ) : proxies.length === 0 ? (
        <div className="rounded-xl bg-card p-4 text-center text-sm text-muted-foreground">No indexer proxies set up in Prowlarr.</div>
      ) : (
        <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/50">
          {proxies.map((proxy) => {
            const result = results[proxy.id];
            return (
              <div key={proxy.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{proxy.name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{proxy.implementationName || proxy.implementation}</Badge>
                    {proxy.tags.filter((id) => tagLabels.has(id)).map((id) => (
                      <Badge key={id} variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">{tagLabels.get(id)}</Badge>
                    ))}
                    {result && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${result === 'passed' ? 'border-green-500/50 text-green-400 light:text-green-700' : 'border-rose-500/40 text-rose-400 light:text-rose-700'}`}
                      >
                        {result === 'passed' ? 'Test passed' : 'Test failed'}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{usedBy(proxy)}</p>
                </div>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs shrink-0"
                    aria-label={`Test ${proxy.name}`}
                    onClick={() => void test(proxy)}
                    disabled={testingId === proxy.id || testingAll}
                  >
                    {testingId === proxy.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
