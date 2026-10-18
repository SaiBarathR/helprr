// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/permission-provider', () => ({
  useMe: () => ({ role: 'admin', capabilities: {} }),
  hasCapability: () => true,
}));

import { EventTypePrefs } from '../event-type-prefs';

// What the server holds per subscription endpoint; tests change it between fetches.
const server = new Map<string, boolean>();
const prefs = (endpoint: string) => [{
  id: `p-${endpoint}`, subscriptionId: `s-${endpoint}`, eventType: 'grabbed',
  enabled: server.get(endpoint) ?? true, tagFilter: null, qualityFilter: null, mutedUserFilter: null,
}];

beforeEach(() => {
  server.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const endpoint = new URL(url, 'http://localhost').searchParams.get('endpoint') ?? '';
    return new Response(JSON.stringify(prefs(endpoint)), { status: 200 });
  }));
});

const grabbed = () => screen.getByRole('switch', { name: 'Download Grabbed' });
// The switch is disabled until the seed has set the subscription id.
const seeded = () => !grabbed().hasAttribute('disabled');

describe('EventTypePrefs seeding', () => {
  it('seeds once per endpoint, so a refetch does not replace the local copy', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (endpoint: string) => (
      <QueryClientProvider client={client}><EventTypePrefs subscriptionEndpoint={endpoint} /></QueryClientProvider>
    );
    server.set('https://push.example/a', true);
    const { rerender } = render(view('https://push.example/a'));
    await waitFor(() => expect(seeded()).toBe(true));
    expect(grabbed().getAttribute('aria-checked')).toBe('true');

    // The server's copy changes and the query refetches (as after a save on
    // another event): the local copy, which may hold edits, stays.
    server.set('https://push.example/a', false);
    await act(() => client.invalidateQueries({ queryKey: ['notification-prefs'] }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(grabbed().getAttribute('aria-checked')).toBe('true');

    // Another subscription seeds afresh from its own data.
    server.set('https://push.example/b', false);
    rerender(view('https://push.example/b'));
    await waitFor(() => expect(grabbed().getAttribute('aria-checked')).toBe('false'));
  });
});
