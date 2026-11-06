// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarFeedDialog, feedUrls } from './calendar-feed-dialog';
import { parseFeedFilters } from '@/lib/calendar-feed/filters';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const TOKEN = 'A'.repeat(43);
const FILTERS = { type: 'episode' as const, instanceId: 'hd', monitoredOnly: true };

afterEach(() => vi.unstubAllGlobals());

function mount(status: { active: boolean; createdAt: string | null; lastUsedAt: string | null }) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({ token: TOKEN, createdAt: '2026-11-07T00:00:00Z' }));
    return new Response(JSON.stringify(status));
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CalendarFeedDialog open onOpenChange={() => {}} filters={FILTERS} instanceLabel="HD (Sonarr)" />
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe('feedUrls', () => {
  it('carries the filters in a form the feed reads back, with a webcal twin', () => {
    const urls = feedUrls('https://helprr.example', TOKEN, FILTERS);
    expect(urls.https.startsWith('https://helprr.example/api/calendar/feed.ics?')).toBe(true);
    expect(urls.webcal).toBe(urls.https.replace('https:', 'webcal:'));
    const params = new URL(urls.https).searchParams;
    expect(params.get('token')).toBe(TOKEN);
    expect(parseFeedFilters(params)).toEqual(FILTERS);
  });

  it('leaves out filters that are not set', () => {
    const params = new URL(feedUrls('http://h', TOKEN, { type: null, instanceId: null, monitoredOnly: false }).https).searchParams;
    expect([...params.keys()]).toEqual(['token']);
  });
});

describe('CalendarFeedDialog', () => {
  it('makes a link and shows it once, with the filters it carries', async () => {
    const fetchMock = mount({ active: false, createdAt: null, lastUsedAt: null });
    expect(await screen.findByText('Episodes · HD (Sonarr) · Monitored only')).toBeTruthy();

    await userEvent.click(await screen.findByRole('button', { name: 'Make link' }));
    const input = (await screen.findByLabelText('Calendar link')) as HTMLInputElement;
    expect(input.value).toBe(`${window.location.origin}/api/calendar/feed.ics?token=${TOKEN}&type=episode&instance=hd&monitored=1`);
    const add = screen.getByRole('link', { name: 'Add to Calendar' });
    expect(add.getAttribute('href')).toBe(input.value.replace(/^https?:/, 'webcal:'));
    expect(fetchMock).toHaveBeenCalledWith('/api/calendar/feed-token', { method: 'POST' });
  });

  it('asks before replacing a link that is on, since the old one stops working', async () => {
    const fetchMock = mount({ active: true, createdAt: '2026-11-01T00:00:00Z', lastUsedAt: null });
    expect(await screen.findByText(/Your calendar link is on/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Make new link' }));
    expect(await screen.findByText('Make a new calendar link?')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});
