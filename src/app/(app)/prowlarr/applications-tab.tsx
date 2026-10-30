'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCan } from '@/components/permission-provider';
import { jsonFetcher } from '@/lib/query-fetch';
import { isProwlarrTestAllResponse } from '@/lib/prowlarr-client';
import type { ProwlarrApplicationSummary, UnsyncedConnection } from '@/lib/prowlarr-applications';

const SYNC_LEVELS: Record<string, string> = {
  disabled: 'Sync off',
  addOnly: 'Add only',
  fullSync: 'Full sync',
};

/**
 * Whether Prowlarr is syncing indexers to each arr. If a sync breaks, indexers
 * silently stop reaching Sonarr or Radarr, and only Helprr knows about an arr it
 * is connected to that Prowlarr has no app for.
 */
export function ApplicationsTab() {
  const canManage = useCan('prowlarr.manage');
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const query = useQuery({
    queryKey: ['prowlarr', 'applications'],
    queryFn: jsonFetcher<{ applications: ProwlarrApplicationSummary[]; unsynced: UnsyncedConnection[] }>('/api/prowlarr/applications'),
    staleTime: 60_000,
  });

  async function test(application: ProwlarrApplicationSummary) {
    setTestingId(application.id);
    try {
      const res = await fetch(`/api/prowlarr/applications/${application.id}/test`, { method: 'POST' });
      if (res.ok) toast.success(`${application.name} test passed`);
      else toast.error(`${application.name} test failed`);
    } catch {
      toast.error(`${application.name} test failed`);
    } finally {
      setTestingId(null);
    }
  }

  async function testAll() {
    setTestingAll(true);
    try {
      const res = await fetch('/api/prowlarr/applications/testall', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !isProwlarrTestAllResponse(data)) {
        toast.error('Test All failed');
      } else if (data.hasFailures) {
        const names = new Map(query.data?.applications.map((application) => [application.id, application.name]));
        const failed = data.results.filter((result) => !result.isValid).map((result) => names.get(result.id) ?? `App ${result.id}`);
        toast.error(`${data.passed} passed, ${data.failed} failed`, { description: failed.join(', ') });
      } else {
        toast.success('All apps passed');
      }
    } catch {
      toast.error('Test All failed');
    } finally {
      setTestingAll(false);
    }
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (query.isError) {
    return <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">Failed to load apps</div>;
  }

  const applications = query.data?.applications ?? [];
  const unsynced = query.data?.unsynced ?? [];

  return (
    <div className="space-y-3">
      {unsynced.length > 0 && (
        <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 space-y-1.5">
          {unsynced.map((connection) => (
            <div key={`${connection.type}-${connection.label}`} className="flex items-start gap-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" aria-label="Warning" />
              <p className="min-w-0 [overflow-wrap:anywhere]">
                {connection.label} is connected to Helprr, but no Prowlarr app points at it.
              </p>
            </div>
          ))}
        </div>
      )}

      {canManage && applications.length > 0 && (
        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={testAll} disabled={testingAll}>
          {testingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
          Test All
        </Button>
      )}

      {applications.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">No apps set up in Prowlarr.</div>
      ) : (
        <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/50">
          {applications.map((application) => (
            <div key={application.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${application.enable && application.syncLevel !== 'disabled' ? 'bg-green-500' : 'bg-amber-500'}`}
                title={application.enable ? 'Enabled' : 'Disabled'}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{application.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{application.implementationName}</Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {SYNC_LEVELS[application.syncLevel] ?? application.syncLevel}
                  </span>
                </div>
              </div>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs shrink-0"
                  aria-label={`Test ${application.name}`}
                  onClick={() => void test(application)}
                  disabled={testingId === application.id}
                >
                  {testingId === application.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test'}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
