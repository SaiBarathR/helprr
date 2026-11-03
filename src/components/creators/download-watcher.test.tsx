// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadWatcher } from './download-watcher';
import { CreatorPlatformProvider } from './platform';

function mount(answers: string[][]) {
  let call = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ videoIds: answers[Math.min(call++, answers.length - 1)] }))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = render(<QueryClientProvider client={client}><CreatorPlatformProvider platform="youtube"><DownloadWatcher /></CreatorPlatformProvider></QueryClientProvider>);
  return { client, invalidate, view };
}

describe('DownloadWatcher', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refreshes the open pages when a download starts by itself, and not on the first look', async () => {
    const { client, invalidate } = mount([[], ['v1']]);
    await waitFor(() => expect(client.getQueryData(['youtube', 'active-downloads'])).toEqual({ videoIds: [] }));
    expect(invalidate).not.toHaveBeenCalled();
    await client.refetchQueries({ queryKey: ['youtube', 'active-downloads'] });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/youtube/jobs?active=1');
  });

  it('stays quiet while nothing changes', async () => {
    const { client, invalidate } = mount([['v1'], ['v1']]);
    await waitFor(() => expect(client.getQueryData(['youtube', 'active-downloads'])).toEqual({ videoIds: ['v1'] }));
    await client.refetchQueries({ queryKey: ['youtube', 'active-downloads'] });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
