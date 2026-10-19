// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ push: vi.fn(), calls: [] as Array<{ url: string; body: Record<string, unknown> }>, order: [] as string[] }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: mocks.push }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { FallbackActions } from '../fallback-actions';

const HASH = '382CC016FF22946008ECDDCB0DDA820F42B0CD5A';
const check = {
  ok: true, errors: [], warnings: [{ code: 'ARR_CLIENT_WITHOUT_CATEGORY', message: 'A download client has no category.' }],
  plan: {
    instance: { id: 'r1', label: 'radarr-anime' }, target: { externalId: 10331, title: 'Night of the Living Dead', year: 1968, existingId: null },
    torrent: { name: 'Film', savePath: '/mnt/exos22/Downloads', files: [{ index: 0, path: 'Film/a.mkv', size: 1, selected: true }, { index: 1, path: 'Film/b.mkv', size: 1, selected: false }] },
    arrSavePath: '/data/Downloads', mapping: { remotePath: '/mnt/exos22/', localPath: '/data/' },
  },
};

beforeEach(() => {
  mocks.push.mockReset();
  mocks.calls = [];
  mocks.order = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    mocks.order.push(url);
    mocks.calls.push({ url, body: JSON.parse(String(init.body)) });
    return url.endsWith('/check')
      ? new Response(JSON.stringify(check))
      : new Response(JSON.stringify({ download: { id: 'md9', status: 'DOWNLOADING' } }), { status: 201 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('starting the advanced fallback', () => {
  it('checks exactly the chosen files, shows where Radarr sees them, and starts only after any late stop settles', async () => {
    const beforeStart = vi.fn(async () => { mocks.order.push('stop settled'); });
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <FallbackActions
          hash={HASH}
          draft={{ service: 'RADARR', instanceId: 'r1', externalId: 10331, title: 'Night of the Living Dead', add: { qualityProfileId: 4, rootFolderPath: '/data/Movies', tags: [] } }}
          source="MAGNET" selectedIndexes={[0]} disabled={false} beforeStart={beforeStart} cancelling={false} onCancel={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Ready to download')).toBeTruthy();
    expect(screen.getByText('/data/Downloads')).toBeTruthy();
    expect(screen.getByText('A download client has no category.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Start download' }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/torrents/linked/md9'));
    const [checked, started] = mocks.calls;
    expect(checked.body).toEqual({
      service: 'RADARR', instanceId: 'r1', externalId: 10331, infoHash: HASH, selectedFileIndexes: [0], source: 'MAGNET',
      add: { qualityProfileId: 4, rootFolderPath: '/data/Movies', tags: [] },
    });
    expect(started.url).toBe('/api/manual-downloads/fallback');
    expect(started.body).toEqual({ ...checked.body, clientRequestId: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(mocks.order).toEqual(['/api/manual-downloads/fallback/check', 'stop settled', '/api/manual-downloads/fallback']);
  });
});
