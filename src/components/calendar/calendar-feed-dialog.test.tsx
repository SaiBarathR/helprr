// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarFeedDialog, feedUrls } from './calendar-feed-dialog';

const mocks = vi.hoisted(() => ({ phone: false }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => mocks.phone }));
// Each Select as a native <select>, so a test can pick an option.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));

const TOKEN = 'A'.repeat(43);
const PAGE_FILTERS = { type: 'episode' as const, instanceId: 'hd', monitoredOnly: true };
const INSTANCES = [{ id: 'hd', label: 'HD (Sonarr)' }, { id: 'rad', label: 'Radarr' }];
const LINK = {
  id: 'link-1', name: 'Calendar', filters: { type: null, instanceId: null, monitoredOnly: false },
  createdAt: '2026-11-01T00:00:00Z', lastUsedAt: null,
};

afterEach(() => {
  mocks.phone = false;
  vi.unstubAllGlobals();
});

function mount(state: { links: unknown[]; max?: number; origin?: string | null }) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ id: 'new', token: TOKEN, name: body.name, filters: body.filters, createdAt: '2026-11-08T00:00:00Z' }));
    }
    if (init?.method === 'DELETE') return new Response(JSON.stringify({ revoked: true }));
    return new Response(JSON.stringify({ max: 10, origin: null, ...state }));
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CalendarFeedDialog open onOpenChange={onOpenChange} filters={PAGE_FILTERS} instances={INSTANCES} />
    </QueryClientProvider>,
  );
  return fetchMock;
}

const onOpenChange = vi.fn();

describe('feedUrls', () => {
  it('carries only the token, with a webcal twin', () => {
    const urls = feedUrls('https://helprr.example', TOKEN);
    expect(urls.https).toBe(`https://helprr.example/api/calendar/feed.ics?token=${TOKEN}`);
    expect(urls.webcal).toBe(urls.https.replace('https:', 'webcal:'));
  });
});

describe('CalendarFeedDialog', () => {
  it('is a bottom sheet on a phone, focused itself rather than its close button or Name field', async () => {
    mocks.phone = true;
    mount({ links: [] });
    const name = await screen.findByLabelText('Name');
    const sheet = screen.getByRole('dialog', { name: 'Subscribe in Calendar' });
    expect(sheet.getAttribute('data-vaul-drawer-direction')).toBe('bottom');
    expect(sheet.contains(name)).toBe(true);
    expect(document.activeElement).toBe(sheet);
  });

  it('focuses the dialog itself, not its close button, on a wide screen', async () => {
    mount({ links: [] });
    await screen.findByLabelText('Name');
    const dialog = screen.getByRole('dialog', { name: 'Subscribe in Calendar' });
    expect(dialog.getAttribute('data-vaul-drawer-direction')).toBeNull();
    expect(document.activeElement).toBe(dialog);
  });

  it("makes a named link with the filters picked, starting from the page's, and shows it once", async () => {
    const fetchMock = mount({ links: [] });
    const name = (await screen.findByLabelText('Name')) as HTMLInputElement;
    expect(name.value).toBe('Episodes');
    await userEvent.clear(name);
    await userEvent.type(name, 'Kids movies');
    const [shows, instance] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(shows.value).toBe('episode');
    expect(instance.value).toBe('hd');
    await userEvent.selectOptions(shows, 'movie');
    await userEvent.selectOptions(instance, 'rad');
    await userEvent.click(screen.getByRole('switch', { name: 'Monitored only' }));

    await userEvent.click(screen.getByRole('button', { name: 'Make link' }));
    const input = (await screen.findByLabelText('Calendar link')) as HTMLInputElement;
    expect(input.value).toBe(`${window.location.origin}/api/calendar/feed.ics?token=${TOKEN}`);
    expect(screen.getByRole('link', { name: 'Open in Calendar app' }).getAttribute('href')).toBe(input.value.replace(/^https?:/, 'webcal:'));
    expect(screen.getByText('Your “Kids movies” link')).toBeTruthy();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ name: 'Kids movies', filters: { type: 'movie', instanceId: 'rad', monitoredOnly: false } });

    // Done closes the sheet, like every other phone sheet; the token is gone from the page.
    onOpenChange.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('Calendar link')).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps showing a link it just made when the list fails to refresh', async () => {
    let gets = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'new', token: TOKEN, name: 'Calendar' }));
      gets += 1;
      return gets === 1 ? new Response(JSON.stringify({ links: [], max: 10, origin: null })) : new Response('down', { status: 500 });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CalendarFeedDialog open onOpenChange={() => {}} filters={PAGE_FILTERS} instances={INSTANCES} />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Make link' }));
    await waitFor(() => expect(gets).toBe(2));
    expect(((await screen.findByLabelText('Calendar link')) as HTMLInputElement).value).toContain(TOKEN);
  });

  it('builds the link from the configured origin rather than the address the page is on', async () => {
    mount({ links: [], origin: 'https://helprr.example' });
    await userEvent.click(await screen.findByRole('button', { name: 'Make link' }));
    const input = (await screen.findByLabelText('Calendar link')) as HTMLInputElement;
    expect(input.value).toBe(`https://helprr.example/api/calendar/feed.ics?token=${TOKEN}`);
  });

  it('lists each link with what it shows, and turns off only the one picked, after asking', async () => {
    const fetchMock = mount({ links: [LINK, { ...LINK, id: 'link-2', name: 'Films', filters: { type: 'movie', instanceId: 'rad', monitoredOnly: true } }] });
    const list = within(await screen.findByRole('region', { name: 'Your links' }));
    expect(list.getByText('Episodes, movies and music')).toBeTruthy();
    expect(list.getByText('Movies · Radarr · Monitored only')).toBeTruthy();

    await userEvent.click(list.getByRole('button', { name: 'Turn off Films' }));
    expect(await screen.findByText('Turn off “Films”?')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/calendar/feed-token/link-2', { method: 'DELETE' }));
  });

  it('offers no new link once the most are made', async () => {
    mount({ links: [LINK, { ...LINK, id: 'link-2' }], max: 2 });
    expect(await screen.findByText(/the most there can be/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Make link' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
