// @vitest-environment jsdom
import { Suspense, type ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: ReactNode }) => <header>{title}</header> }));
vi.mock('@/components/ui/app-link', () => ({ default: (props: React.ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('@/components/creators/use-file-actions', () => ({ useFileActions: () => ({ groupsFor: () => [], sheet: null }) }));

import { getQueryClient } from '@/lib/query-client';
import { CreatorPlatformProvider } from '@/components/creators/platform';
import { CreatorFilePage } from './file-page';

// The app's own client, so the page is held to the app's retry rule.
async function renderWithAppClient() {
  await act(async () => {
    render(
      <QueryClientProvider client={getQueryClient()}>
        <CreatorPlatformProvider platform="youtube">
          <Suspense fallback={null}><CreatorFilePage params={Promise.resolve({ id: 'f1' })} /></Suspense>
        </CreatorPlatformProvider>
      </QueryClientProvider>,
    );
  });
}

afterEach(() => {
  getQueryClient().clear();
  vi.unstubAllGlobals();
});

describe('CreatorFilePage retries (the app rule)', () => {
  it('does not ask again after a refusal', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    await renderWithAppClient();
    expect(await screen.findByText("Couldn't load this file")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says a deleted file is deleted, after one request', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await renderWithAppClient();
    expect(await screen.findByText('This file has been deleted.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks once more after a server error', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    await renderWithAppClient();
    expect(await screen.findByText("Couldn't load this file", {}, { timeout: 4_000 })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
