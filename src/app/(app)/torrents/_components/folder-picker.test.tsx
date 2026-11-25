// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ mobile: true }));
// One qBittorrent, the default (use-qbit-instance.test.ts covers choosing one).
vi.mock('@/app/(app)/torrents/_components/use-qbit-instance', () => ({
  qbitInstanceKey: (id: string | undefined) => id ?? 'default',
  useQbitInstance: () => ({ instanceId: undefined, instances: [], multiInstance: false, current: undefined, subtitle: undefined, select: () => {} }),
}));
vi.mock('@/hooks/use-is-mobile', () => ({ useIsMobile: () => mocks.mobile }));
// The sheet and the dialog, reduced to what they hold and which one it is.
vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Drawer: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div data-frame="drawer">{children}</div> : null),
    DrawerContent: Pass, DrawerHeader: Pass, DrawerTitle: Pass, DrawerDescription: Pass, DrawerFooter: Pass,
  };
});
vi.mock('@/components/ui/dialog', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div data-frame="dialog">{children}</div> : null),
    DialogContent: Pass, DialogHeader: Pass, DialogTitle: Pass, DialogDescription: Pass, DialogFooter: Pass,
  };
});

import { FolderPickerButton, type FolderPurpose } from './folder-picker';

// What the folders route answers, by the path asked for ('' is the top).
const LISTINGS: Record<string, unknown> = {
  '': { path: null, parent: null, folders: ['/data/movies', '/downloads'], total: 2, truncated: false },
  '/downloads': { path: '/downloads', parent: null, folders: ['movies', 'tv'], total: 2, truncated: false },
  '/downloads/tv': { path: '/downloads/tv', parent: '/downloads', folders: ['Anime'], total: 1, truncated: false },
};

let asked: URL[];

beforeEach(() => {
  mocks.mobile = true;
  asked = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    asked.push(url);
    const listing = LISTINGS[url.searchParams.get('path') ?? ''];
    return listing
      ? Response.json(listing)
      : Response.json({ error: 'That folder is outside the download folders' }, { status: 400 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const renderPicker = (value: string, purpose: FolderPurpose = 'location') => {
  const onPick = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FolderPickerButton purpose={purpose} value={value} onPick={onPick} />
    </QueryClientProvider>,
  );
  return onPick;
};

describe('folder picker', () => {
  it('drills down from the download folders and hands back the folder the server checked', async () => {
    const onPick = renderPicker('');
    await userEvent.click(screen.getByRole('button', { name: 'Browse folders' }));
    // At the top there is nothing to use yet.
    expect((await screen.findByRole('button', { name: '/downloads' })) as HTMLButtonElement).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Use This Folder' }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: '/downloads' }));
    await userEvent.click(await screen.findByRole('button', { name: 'tv' }));
    expect(await screen.findByRole('button', { name: 'Anime' })).toBeTruthy();

    // Up goes to the folder above, then to the list of download folders.
    await userEvent.click(screen.getByRole('button', { name: 'downloads' }));
    expect(await screen.findByRole('button', { name: 'movies' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'tv' }));
    await screen.findByRole('button', { name: 'Anime' });
    await userEvent.click(screen.getByRole('button', { name: 'Use This Folder' }));

    expect(onPick).toHaveBeenCalledWith('/downloads/tv');
    expect(screen.queryByRole('button', { name: 'Use This Folder' })).toBeNull();
    expect(asked.every((url) => url.pathname === '/api/qbittorrent/folders' && url.searchParams.get('for') === 'location')).toBe(true);
  });

  it('opens at the typed folder when it may list it', async () => {
    renderPicker('/downloads/tv', 'add');
    await userEvent.click(screen.getByRole('button', { name: 'Browse folders' }));
    expect(await screen.findByRole('button', { name: 'Anime' })).toBeTruthy();
    expect(asked[0].searchParams.get('for')).toBe('add');
  });

  it('starts from the top, and says why, when the typed folder is outside', async () => {
    renderPicker('/etc', 'category');
    await userEvent.click(screen.getByRole('button', { name: 'Browse folders' }));
    expect(await screen.findByText(/\/etc can.t be listed here, so this starts from the default save path/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: '/downloads' })).toBeTruthy());
  });

  it('is a sheet on phones and a dialog on wider screens', async () => {
    renderPicker('');
    await userEvent.click(screen.getByRole('button', { name: 'Browse folders' }));
    expect(document.querySelector('[data-frame="drawer"]')).toBeTruthy();
    cleanup();

    mocks.mobile = false;
    renderPicker('/downloads');
    await userEvent.click(screen.getByRole('button', { name: 'Browse folders' }));
    expect(await screen.findByRole('button', { name: 'tv' })).toBeTruthy();
    expect(document.querySelector('[data-frame="dialog"]')).toBeTruthy();
    expect(document.querySelector('[data-frame="drawer"]')).toBeNull();
  });

  it('says when a long folder is cut short', async () => {
    LISTINGS['/big'] = { path: '/big', parent: null, folders: ['a'], total: 900, truncated: true };
    renderPicker('/big');
    await userEvent.click(screen.getByRole('button', { name: 'Browse folders' }));
    expect(await screen.findByText('Showing the first 1 of 900 folders. Type the path to reach the others.')).toBeTruthy();
  });
});
