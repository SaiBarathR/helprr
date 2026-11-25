// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7' }),
  useSearchParams: () => new URLSearchParams('instance=son-2'),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }));
// The real goBackOr, which goes Back only when this tab has an earlier in-app page.
vi.mock('@/components/layout/navigation-provider', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/layout/navigation-provider')>(),
  useAppRouter: () => router,
}));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/components/media/tag-selector', () => ({ TagSelector: () => null }));
// Each Select as a native <select>, so a test can pick an option.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import SeriesEditPage from './page';

const SERIES = {
  id: 7, title: 'Show', qualityProfileId: 4, seriesType: 'standard', seasonFolder: true,
  monitored: true, monitorNewItems: 'none', tags: [], path: '/tv/Show', seasons: [],
};
let puts: { url: string; body: Record<string, unknown> }[];

beforeEach(() => {
  puts = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (init?.method === 'PUT') {
      puts.push({ url: `${url.pathname}${url.search}`, body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const body = url.pathname === '/api/sonarr/7' ? SERIES
      : url.pathname === '/api/sonarr/qualityprofiles' ? [{ id: 4, name: 'HD' }]
        : url.pathname === '/api/sonarr/rootfolders' ? [{ id: 1, path: '/tv' }, { id: 2, path: '/tv2' }]
          : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  sessionStorage.clear();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SeriesEditPage /></QueryClientProvider>);
}

const rootFolderSelect = () =>
  screen.getAllByRole('combobox').find((select) =>
    Array.from((select as HTMLSelectElement).options, (o) => o.value).join() === '/tv,/tv2') as HTMLSelectElement;

const monitorNewSeasonsSelect = () =>
  screen.getAllByRole('combobox').find((select) =>
    Array.from((select as HTMLSelectElement).options, (o) => o.value).join() === 'all,none') as HTMLSelectElement;

describe('edit series page', () => {
  it("shows the series' own Monitor New Seasons setting and saves the change on its instance", async () => {
    renderPage();
    await screen.findByText('Monitor New Seasons');
    await waitFor(() => expect(monitorNewSeasonsSelect().value).toBe('none'));

    fireEvent.change(monitorNewSeasonsSelect(), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toBe('/api/sonarr/7?instanceId=son-2');
    expect(puts[0].body).toEqual(expect.objectContaining({ id: 7, monitorNewItems: 'all', seriesType: 'standard' }));
  });

  it('keeps the setting unchanged when the user saves without touching it', async () => {
    renderPage();
    await screen.findByText('Monitor New Seasons');
    await waitFor(() => expect(monitorNewSeasonsSelect().value).toBe('none'));

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual(expect.objectContaining({ monitorNewItems: 'none' }));
  });

  it('moves the files to a new root folder only after a confirmation', async () => {
    renderPage();
    await waitFor(() => expect(rootFolderSelect().value).toBe('/tv'));
    expect(screen.queryByLabelText('Move Files')).toBeNull();

    fireEvent.change(rootFolderSelect(), { target: { value: '/tv2' } });
    expect((screen.getByLabelText('Move Files') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Move files for Show?' });
    expect(confirm.textContent).toContain('into /tv2/Show');
    expect(puts).toHaveLength(0);

    fireEvent.click(within(confirm).getByRole('button', { name: 'Move files' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toBe('/api/sonarr/7?moveFiles=true&instanceId=son-2');
    expect(puts[0].body).toEqual(expect.objectContaining({ path: '/tv2/Show' }));
  });

  it('changes only the saved path, without asking, when Move Files is off', async () => {
    renderPage();
    await waitFor(() => expect(rootFolderSelect().value).toBe('/tv'));
    fireEvent.change(rootFolderSelect(), { target: { value: '/tv2' } });
    fireEvent.click(screen.getByLabelText('Move Files'));
    expect(screen.getByText(/Only the saved path changes/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(puts[0].url).toBe('/api/sonarr/7?instanceId=son-2');
    expect(puts[0].body).toEqual(expect.objectContaining({ path: '/tv2/Show' }));
  });
});

describe('renaming the folder', () => {
  const folderField = () => screen.getByLabelText('Folder') as HTMLInputElement;

  it('starts from the current folder name and moves the files into the renamed folder after a confirmation', async () => {
    renderPage();
    await waitFor(() => expect(folderField().value).toBe('Show'));
    expect(screen.queryByLabelText('Move Files')).toBeNull();

    fireEvent.change(folderField(), { target: { value: 'Show (2020)' } });
    // The path wraps after each separator, so its text spans several elements.
    expect(screen.getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === 'New path: /tv/Show (2020)')).toBeTruthy();
    expect(document.querySelectorAll('wbr').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Move files for Show?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Move files' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toBe('/api/sonarr/7?moveFiles=true&instanceId=son-2');
    expect(puts[0].body).toEqual(expect.objectContaining({ path: '/tv/Show (2020)' }));
  });

  it('joins a new root folder and a new name', async () => {
    renderPage();
    await waitFor(() => expect(rootFolderSelect().value).toBe('/tv'));
    fireEvent.change(rootFolderSelect(), { target: { value: '/tv2' } });
    fireEvent.change(folderField(), { target: { value: 'Show (2020)' } });
    fireEvent.click(screen.getByLabelText('Move Files'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual(expect.objectContaining({ path: '/tv2/Show (2020)' }));
  });

  it.each(['..', 'Show.', ' Show', 'a/b', ''])('explains why %j cannot be saved and keeps Save off', async (name) => {
    renderPage();
    await waitFor(() => expect(folderField().value).toBe('Show'));
    fireEvent.change(folderField(), { target: { value: name } });
    expect(folderField().getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(folderField().getAttribute('aria-describedby')!)?.textContent).toBeTruthy();
    expect(screen.queryByLabelText('Move Files')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('leaving the edit page', () => {
  it('goes Back after saving when it was opened from inside Helprr', async () => {
    sessionStorage.setItem('helprr:in-app-history', '1');
    renderPage();
    await waitFor(() => expect(rootFolderSelect().value).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('opens the detail page after saving or cancelling when opened directly (no earlier page)', async () => {
    renderPage();
    await waitFor(() => expect(rootFolderSelect().value).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/series/7?instance=son-2'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(router.replace).toHaveBeenLastCalledWith('/series/7?instance=son-2');
    expect(router.back).not.toHaveBeenCalled();
  });
});
