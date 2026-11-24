// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ProwlarrIndexerSummary } from '@/lib/prowlarr-client';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { useIndexerActions } from './use-indexer-actions';

const indexer: ProwlarrIndexerSummary = {
  id: 7, name: 'YTS', enable: false, protocol: 'torrent', privacy: 'public', priority: 25,
  implementationName: 'YTS', tags: [], appProfileId: 1, categories: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('useIndexerActions pending edits', () => {
  it('lays a bulk edit over a single edit still on its way, rather than replacing it', async () => {
    const answers: Array<(res: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => answers.push(resolve))));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useIndexerActions(), { wrapper });

    let toggle!: Promise<void>;
    let bulk!: Promise<boolean>;
    act(() => {
      toggle = result.current.handleToggle(indexer, true);
    });
    act(() => {
      bulk = result.current.handleBulkEdit([indexer], () => ({ priority: 5 }), { priority: 5 }, { success: 'ok', failure: 'no' });
    });

    expect(result.current.pendingEdits.get(7)).toEqual({ enable: true, priority: 5 });

    await act(async () => {
      answers.forEach((answer) => answer(Response.json({ ok: true })));
      await Promise.all([toggle, bulk]);
    });
    expect(result.current.pendingEdits.size).toBe(0);
  });
});
