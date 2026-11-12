// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { DatabaseBackupSection } from './database-backup-section';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

function show(response: Response | ((url: string, init?: RequestInit) => Response)) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    typeof response === 'function' ? response(url, init) : response);
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DatabaseBackupSection />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const status = (over: Record<string, unknown> = {}) => ({
  lastBackupAt: daysAgo(1),
  folder: { ok: true },
  backups: [{ name: 'helprr-backup-20261106-030000.dump', sizeBytes: 2048, createdAt: daysAgo(1) }],
  running: false,
  lastRun: null,
  timeZone: 'Europe/Berlin',
  schedule: 'daily',
  hour: 3,
  dayOfWeek: 0,
  keep: 7,
  alertDays: 7,
  ...over,
});

describe('DatabaseBackupSection', () => {
  it('shows how long ago backup.sh last backed up the database', async () => {
    const fetchMock = show(new Response(JSON.stringify({ lastBackupAt: daysAgo(3) })));
    const value = await screen.findByText('3 days ago');
    expect(value.className).not.toContain('amber');
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/database-backup', expect.anything());
    expect(screen.getByRole('link', { name: /How to back up and restore/ }).getAttribute('href')).toBe(
      'https://saibarathr.github.io/helprr/maintain/backup/',
    );
  });

  it('shows an old backup in amber', async () => {
    show(new Response(JSON.stringify({ lastBackupAt: daysAgo(12) })));
    expect((await screen.findByText(/12 days ago/)).className).toContain('amber');
  });

  it('says in amber when none was recorded', async () => {
    show(new Response(JSON.stringify({ lastBackupAt: null })));
    expect((await screen.findByText('None recorded')).className).toContain('amber');
  });

  it('says it cannot tell when the read fails', async () => {
    show(new Response('{}', { status: 500 }));
    expect((await screen.findByText('Unavailable')).className).not.toContain('amber');
  });

  it('shows the schedule and the backups on the server, never as downloads', async () => {
    show(new Response(JSON.stringify(status())));
    const name = await screen.findByText('helprr-backup-20261106-030000.dump');
    // Size and age sit on their own line, so they never cut the name's date off.
    expect(name.nextElementSibling?.textContent).toMatch(/^2(\.0)? KB · 1 day ago$/);
    // backup.sh keeps its dumps elsewhere: the footer says only its time is shown.
    expect(screen.getByText(/Last database backup counts backup\.sh runs too/)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Frequency' }).textContent).toContain('Daily');
    expect(screen.getByRole('combobox', { name: 'Keep' }).textContent).toContain('Newest 7');
    expect(screen.getByText(/Times are in Europe\/Berlin/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /helprr-backup/ })).toBeNull();
  });

  it('turns Back up now off and says why when the folder is not mounted', async () => {
    show(new Response(JSON.stringify(status({ folder: { ok: false, reason: 'not-mounted' }, backups: [] }))));
    const button = await screen.findByRole('button', { name: /Back up now/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Backup folder not mounted')).toBeTruthy();
    expect(screen.queryByText('On the server')).toBeNull();
  });

  it('starts a backup, follows it, and says how it went', async () => {
    let runs = 0;
    const fetchMock = show((url, init) => {
      if (init?.method === 'POST') {
        runs += 1;
        return new Response(JSON.stringify({ started: true }), { status: 202 });
      }
      return new Response(JSON.stringify(status(runs === 0 ? {} : {
        lastRun: { ok: true, fileName: 'helprr-backup-20261107-090000.dump', sizeBytes: 9, finishedAt: '2026-11-07T09:00:01.000Z' },
      })));
    });
    await userEvent.click(await screen.findByRole('button', { name: /Back up now/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Backed up the database: helprr-backup-20261107-090000.dump'));
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/database-backup', { method: 'POST' });
  });

  it('shows the error when Back up now is refused', async () => {
    show((url, init) => init?.method === 'POST'
      ? new Response(JSON.stringify({ error: 'A backup is already running' }), { status: 409 })
      : new Response(JSON.stringify(status())));
    await userEvent.click(await screen.findByRole('button', { name: /Back up now/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A backup is already running'));
  });
});
