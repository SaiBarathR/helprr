import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateInstances } from '@/lib/query-invalidation';
import { queryKeys } from '@/lib/query-keys';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

// /api/services (every connection, admin) and /api/instances (id/type/label for
// pickers) return different shapes; sharing a key served one as the other.
describe('connection list query keys', () => {
  it('keeps the two lists under keys that do not overlap', () => {
    expect(queryKeys.arrInstances()[0]).not.toBe(queryKeys.instances()[0]);
  });

  it('never caches /api/instances under the /api/services key', () => {
    const offenders = sourceFiles(path.join(process.cwd(), 'src')).filter((file) =>
      /queryKey: queryKeys\.instances\(\),\s*\n\s*queryFn: jsonFetcher<[^\n]*>\('\/api\/instances'\)/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('drops the picker list when instances change, so an add page cannot start from the old default', () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.arrInstances(), [{ id: 'a', type: 'RADARR', label: 'A', isDefault: true }]);
    qc.setQueryData(queryKeys.instances(), [{ id: 'a' }]);

    invalidateInstances(qc);

    expect(qc.getQueryData(queryKeys.arrInstances())).toBeUndefined();
    expect(qc.getQueryState(queryKeys.instances())?.isInvalidated).toBe(true);
  });

  it('refreshes every connection list when Settings changes the default', () => {
    const page = readFileSync(path.join(process.cwd(), 'src/app/(app)/settings/instances/page.tsx'), 'utf8');
    const onDefault = page.slice(page.indexOf('is now the default'), page.indexOf('onError', page.indexOf('is now the default')));
    expect(onDefault).toContain('invalidateInstances(queryClient)');
  });
});
