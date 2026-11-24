import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendSeriesBulkEdit } from '@/lib/series-monitor';

// One instance's share of the series bulk "More" edit: which calls go out, in
// which order, and which response decides the instance's outcome.
afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: Record<string, number> = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url, 'http://localhost').pathname;
    calls.push(`${init.method} ${url} ${init.body}`);
    return new Response('{}', { status: status[path] ?? 200 });
  }));
  return calls;
}

describe('sendSeriesBulkEdit', () => {
  it('sends a Monitoring choice to the season pass on the instance', async () => {
    const calls = stubFetch();
    const res = await sendSeriesBulkEdit('son 2', [1, 2], { monitor: 'future' });
    expect(res.ok).toBe(true);
    expect(calls).toEqual(['POST /api/sonarr/seasonpass?instanceId=son%202 {"ids":[1,2],"monitor":"future"}']);
  });

  it('sends settings alone to the editor, on the default instance when none is named', async () => {
    const calls = stubFetch();
    await sendSeriesBulkEdit(undefined, [1], { seriesType: 'anime' });
    expect(calls).toEqual(['PUT /api/sonarr/editor {"ids":[1],"seriesType":"anime"}']);
  });

  it('applies the repeatable season pass before a file move, and stops there when it fails', async () => {
    const changes = { monitor: 'all' as const, rootFolderPath: '/tv2', moveFiles: true };
    let calls = stubFetch();
    await sendSeriesBulkEdit('s', [1], changes);
    expect(calls.map((c) => c.split(' ')[1].split('?')[0])).toEqual(['/api/sonarr/seasonpass', '/api/sonarr/editor']);

    // A retry after this failure sends both again: the season pass is safe to
    // repeat, and the move never ran.
    calls = stubFetch({ '/api/sonarr/seasonpass': 500 });
    const res = await sendSeriesBulkEdit('s', [1], changes);
    expect(res.status).toBe(500);
    expect(calls).toHaveLength(1);
  });

  it("reports the editor's failure after a season pass that worked", async () => {
    stubFetch({ '/api/sonarr/editor': 400 });
    expect((await sendSeriesBulkEdit('s', [1], { monitor: 'none', seriesType: 'daily' })).status).toBe(400);
  });
});
