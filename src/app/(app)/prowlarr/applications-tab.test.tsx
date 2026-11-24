// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApplicationsTab } from './applications-tab';

vi.mock('@/components/permission-provider', () => ({ useCan: () => false }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url === '/api/prowlarr/tags'
      ? [{ id: 1, label: 'anime' }, { id: 2, label: 'unused' }]
      : { applications: [{ id: 5, name: 'Sonarr', implementationName: 'Sonarr', syncLevel: 'fullSync', enable: true, tags: [1, 9] }], unsynced: [] },
  ))));
});

describe('ApplicationsTab', () => {
  it('names the tags on each app, leaving out ones Prowlarr no longer has', async () => {
    render(<QueryClientProvider client={new QueryClient()}><ApplicationsTab /></QueryClientProvider>);
    expect(await screen.findByText('anime')).toBeTruthy();
    expect(screen.queryByText('unused')).toBeNull();
    expect(screen.queryByText('9')).toBeNull();
  });
});
