// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// A stand-in picker: one button adds tag 5.
vi.mock('@/components/media/tag-selector', () => ({
  TagSelector: ({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) => (
    <button type="button" onClick={() => onChange([...value, 5])}>Add tag 5</button>
  ),
}));
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

import { CollectionEditForm } from '../collection-edit-form';
import type { CollectionSummary } from '@/types';

const COLLECTION = {
  id: 7, title: 'Pair', monitored: false, poster: null, genres: [], movieCount: 2, missingMovies: 1, movies: [],
  qualityProfileId: 1, rootFolderPath: '/movies', minimumAvailability: 'released', searchOnAdd: false, tags: [4],
  instanceId: 'r1',
} as CollectionSummary;
let puts: Record<string, unknown>[];
let requested: string[];

beforeEach(() => {
  puts = [];
  requested = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (init?.method === 'PUT') {
      puts.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    requested.push(url.pathname);
    const body = url.pathname === '/api/radarr/qualityprofiles' ? [{ id: 1, name: 'Any' }, { id: 4, name: 'HD' }]
      : url.pathname === '/api/radarr/rootfolders' ? [{ id: 1, path: '/movies' }, { id: 2, path: '/archive' }]
        : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const ALL = { isAdmin: true, canMonitor: true, canEditTags: true, canChangePath: true };

function renderForm(perms: Partial<typeof ALL> = ALL, onSaved = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CollectionEditForm collection={COLLECTION} {...ALL} {...perms} onSaved={onSaved} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
  return onSaved;
}

const selectWith = (values: string) =>
  screen.getAllByRole('combobox').find((s) => Array.from((s as HTMLSelectElement).options, (o) => o.value).join() === values) as HTMLSelectElement;
const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

describe('Edit collection', () => {
  it('starts from the collection’s own options and saves nothing until one changes', async () => {
    renderForm();
    await waitFor(() => expect(selectWith('1,4').value).toBe('1'));
    expect(selectWith('/movies,/archive').value).toBe('/movies');
    expect(selectWith('announced,inCinemas,released').value).toBe('released');
    expect(save().disabled).toBe(true);
  });

  it('sends only the changed fields, on the collection’s instance', async () => {
    const onSaved = renderForm();
    await waitFor(() => expect(selectWith('1,4').value).toBe('1'));
    fireEvent.change(selectWith('1,4'), { target: { value: '4' } });
    fireEvent.change(selectWith('/movies,/archive'), { target: { value: '/archive' } });
    fireEvent.change(selectWith('keep,monitor,unmonitor'), { target: { value: 'unmonitor' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Search on Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add tag 5' }));
    fireEvent.click(save());
    await waitFor(() => expect(puts).toHaveLength(1));
    const expected = { monitorMovies: false, qualityProfileId: 4, rootFolderPath: '/archive', searchOnAdd: true, tags: [4, 5] };
    expect(puts[0]).toEqual({ collectionId: 7, instanceId: 'r1', ...expected });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expected));
  });

  it('offers a member only what they may change, and fetches no profiles or folders for them', async () => {
    renderForm({ isAdmin: false, canMonitor: false, canChangePath: false, canEditTags: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag 5' }));
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.click(save());
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ collectionId: 7, instanceId: 'r1', tags: [4, 5] });
    expect(requested).not.toContain('/api/radarr/qualityprofiles');
    expect(requested).not.toContain('/api/radarr/rootfolders');
  });
});
