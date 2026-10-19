import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
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
});
