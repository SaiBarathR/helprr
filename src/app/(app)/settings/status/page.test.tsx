// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Service status shows each Sonarr/Radarr/Lidarr instance's health to those
// who may read it, and a health push's link opens that instance's sheet.

const mocks = vi.hoisted(() => ({
  me: null as unknown,
  search: new URLSearchParams(),
  healthCalls: [] as string[],
  healthUrls: [] as string[],
  statuses: [] as unknown[],
  systemUrls: [] as string[],
  posts: [] as Array<{ url: string; body: unknown }>,
  sent: [] as Array<{ url: string; method: string; body: unknown }>,
  refusePassword: false,
}));
vi.mock('@/components/permission-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/permission-provider')>()),
  useMe: () => mocks.me,
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.search }));
vi.mock('@/lib/hooks/use-app-settings', () => ({ useAppSettings: () => ({ settings: null, update: vi.fn() }) }));
vi.mock('@/components/settings/polling-health-section', () => ({ PollingHealthSection: () => null }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import ServiceStatusPage from './page';

const ADMIN = { id: 'a', role: 'admin', capabilities: {} };
const MEMBER = { id: 'm', role: 'member', capabilities: { 'series.view': true, 'movies.view': true } };

const statuses = [
  { instanceId: 'son-1', type: 'SONARR', name: 'Sonarr', label: 'Sonarr', ok: true },
  { instanceId: 'son-2', type: 'SONARR', name: 'Sonarr', label: 'Anime', ok: true },
  { instanceId: 'rad-1', type: 'RADARR', name: 'Radarr', label: 'Radarr', ok: false, error: 'Connection refused' },
];
const health: Record<string, unknown[]> = {
  'son-1': [],
  'son-2': [
    { source: 'IndexerStatusCheck', type: 'warning', message: 'Indexers unavailable: Nyaa', wikiUrl: 'https://wiki.servarr.com/sonarr/system#indexers' },
    { source: 'RootFolderCheck', type: 'error', message: 'Missing root folder: /anime', wikiUrl: '' },
  ],
};

beforeEach(() => {
  mocks.me = ADMIN;
  mocks.search = new URLSearchParams();
  mocks.healthCalls = [];
  mocks.healthUrls = [];
  mocks.statuses = statuses;
  mocks.systemUrls = [];
  mocks.posts = [];
  mocks.sent = [];
  mocks.refusePassword = false;
  // vaul captures the pointer on a press inside the sheet; jsdom has no pointer capture.
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/services/health') return new Response(JSON.stringify(mocks.statuses));
    if (url.startsWith('/api/admin/arr-system/')) return systemResponse(url, init);
    const match = url.match(/^\/api\/(sonarr|radarr|lidarr)\/health\?instanceId=(.+)$/);
    if (match) {
      mocks.healthCalls.push(match[2]);
      mocks.healthUrls.push(url);
      // As the real routes do, another service's instance id is not found.
      if (!match[2].startsWith(match[1].slice(0, 3))) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(health[match[2]] ?? []));
    }
    return new Response('{}');
  }));
});

const SYSTEM: Record<string, unknown> = {
  'son-1': { version: '4.0.20.3014', branch: 'main', updateVersion: null, updateChecked: true },
  'son-2': { version: '4.0.20.3014', branch: 'main', updateVersion: '4.0.21.3100', updateChecked: true },
  'pro-1': { version: '3.0.2.5780', branch: 'master', updateVersion: '3.1.0.5799', updateChecked: true },
};
const TASKS = [
  { taskName: 'ApplicationUpdateCheck', name: 'Application Update Check', intervalMinutes: 360, lastExecution: null, nextExecution: null, lastDurationSeconds: null, canRun: false },
  { taskName: 'CheckHealth', name: 'Check Health', intervalMinutes: 360, lastExecution: '2026-11-24T13:47:56.000Z', nextExecution: null, lastDurationSeconds: 0.6, canRun: true },
];
function logEntry(id: number) {
  return { id, time: '2026-11-24T13:47:56.000Z', level: id === 1 ? 'error' : 'warn', logger: 'Torznab', message: `Entry ${id}`, exception: '' };
}

const BACKUPS = [
  { id: 222, name: 'sonarr_backup_v4.0.20.3014_2026.11.25_10.49.27.zip', type: 'manual', size: 16008, time: '2026-11-25T10:49:27.000Z' },
  { id: 111, name: 'sonarr_backup_v4.0.20.3014_2026.11.20_03.00.00.zip', type: 'scheduled', size: 725817, time: '2026-11-20T03:00:00.000Z' },
];

function systemResponse(url: string, init?: RequestInit): Response {
  mocks.systemUrls.push(url);
  const instance = new URL(url, 'http://x').searchParams.get('instanceId') ?? '';
  if (url.startsWith('/api/admin/arr-system/backups/upload')) {
    const form = init?.body as FormData;
    mocks.sent.push({ url, method: init?.method ?? 'GET', body: Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `file:${(v as File).name}`])) });
    return new Response(JSON.stringify({ ok: true, restarted: false }));
  }
  if (url.startsWith('/api/admin/arr-system/power') || /\/backups\/\d+/.test(url)) {
    mocks.sent.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body)) });
    if (mocks.refusePassword) {
      return new Response(JSON.stringify({ error: 'Current password is incorrect', field: 'currentPassword' }), { status: 403 });
    }
    return new Response(JSON.stringify({ ok: true }));
  }
  if (url.startsWith('/api/admin/arr-system/backups')) return new Response(JSON.stringify(BACKUPS));
  if (url.startsWith('/api/admin/arr-system/status')) return new Response(JSON.stringify(SYSTEM[instance] ?? {}));
  if (url.startsWith('/api/admin/arr-system/tasks/')) {
    return new Response(JSON.stringify({ id: 9, name: 'CheckHealth', status: 'completed' }));
  }
  if (url.startsWith('/api/admin/arr-system/tasks')) {
    if (init?.method === 'POST') {
      mocks.posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ id: 9, name: 'CheckHealth', status: 'queued' }));
    }
    return new Response(JSON.stringify(TASKS));
  }
  const page = Number(new URL(url, 'http://x').searchParams.get('page'));
  const first = (page - 1) * 50 + 1;
  return new Response(JSON.stringify({
    page,
    pageSize: 50,
    totalRecords: 60,
    entries: Array.from({ length: page === 1 ? 50 : 10 }, (_, index) => logEntry(first + index)),
  }));
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ServiceStatusPage />
    </QueryClientProvider>,
  );
}

describe('Service status health', () => {
  it('sums up each reachable instance, and opens its checks, errors first', async () => {
    renderPage();
    expect(await screen.findByText('2 health issues')).toBeTruthy();
    expect(screen.getByText('No health issues')).toBeTruthy();
    // An unreachable instance's health is not asked for.
    expect(mocks.healthCalls.sort()).toEqual(['son-1', 'son-2']);

    await userEvent.click(screen.getByRole('button', { name: /Anime.*2 health issues/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Sonarr · Anime')).toBeTruthy();
    const messages = within(sheet).getAllByText(/Missing root folder|Indexers unavailable/).map((el) => el.textContent);
    expect(messages).toEqual(['Missing root folder: /anime', 'Indexers unavailable: Nyaa']);
    expect(within(sheet).getByText('· Root Folder')).toBeTruthy();
    expect(within(sheet).getByRole('link', { name: /Learn more/ }).getAttribute('href')).toBe('https://wiki.servarr.com/sonarr/system#indexers');
  });

  it("opens the instance a health push's link names, then drops the link from the URL", async () => {
    window.history.replaceState({ kept: true }, '', '/settings/status?health=sonarr&instance=son-2');
    const replace = vi.spyOn(window.history, 'replaceState');
    mocks.search = new URLSearchParams('health=sonarr&instance=son-2');
    renderPage();
    const sheet = await screen.findByRole('dialog');
    await waitFor(() => expect(within(sheet).getByText('Missing root folder: /anime')).toBeTruthy());
    expect(within(sheet).getByText('Sonarr · Anime')).toBeTruthy();
    // Back to this page, or a reload, doesn't open it again; the page's history state stays.
    expect(replace).toHaveBeenCalledWith({ kept: true }, '', '/settings/status');
    replace.mockRestore();
  });

  it("opens the instance's own health when a link names the wrong service", async () => {
    mocks.search = new URLSearchParams('health=radarr&instance=son-2');
    renderPage();
    const sheet = await screen.findByRole('dialog');
    await waitFor(() => expect(within(sheet).getByText('Missing root folder: /anime')).toBeTruthy());
    expect(within(sheet).getByText('Sonarr · Anime')).toBeTruthy();
    expect(within(sheet).queryByText(/Radarr/)).toBeNull();
    // Not even briefly: the wrong service's health is never asked for.
    expect(mocks.healthUrls).not.toContain('/api/radarr/health?instanceId=son-2');
  });

  it('opens nothing when a link names an instance that has no health', async () => {
    mocks.statuses = [...statuses, { instanceId: 'qbt-1', type: 'QBITTORRENT', name: 'qBittorrent', label: 'qBittorrent', ok: true }];
    mocks.search = new URLSearchParams('health=sonarr&instance=qbt-1');
    renderPage();
    expect(await screen.findByText('2 health issues')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText(/qBittorrent health/)).toBeNull();
    expect(mocks.healthUrls.some((url) => url.includes('qbt-1'))).toBe(false);
  });

  it('shows no health to a member without notify.health, and ignores the link', async () => {
    mocks.me = MEMBER;
    mocks.search = new URLSearchParams('health=sonarr&instance=son-2');
    renderPage();
    expect(await screen.findAllByText('Online')).toHaveLength(2);
    expect(screen.queryByText(/health issue/)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /Anime/ })).toBeNull();
    expect(mocks.healthCalls).toEqual([]);
  });

  it('shows health to a member granted notify.health', async () => {
    mocks.me = { ...MEMBER, capabilities: { ...MEMBER.capabilities, 'notify.health': true } };
    renderPage();
    expect(await screen.findByText('2 health issues')).toBeTruthy();
  });
});

describe('Service status, for admins: versions, tasks and logs', () => {
  const withProwlarr = [...statuses, { instanceId: 'pro-1', type: 'PROWLARR', name: 'Prowlarr', label: 'Prowlarr', ok: true }];

  it("shows each reachable instance's version and offered update", async () => {
    mocks.statuses = withProwlarr;
    renderPage();
    expect(await screen.findByText('v4.0.20.3014')).toBeTruthy();
    expect(screen.getByText('v4.0.20.3014 · update available (v4.0.21.3100)')).toBeTruthy();
    expect(screen.getByText('v3.0.2.5780 · update available (v3.1.0.5799)')).toBeTruthy();
    // An unreachable instance is not asked.
    expect(mocks.systemUrls.some((url) => url.includes('rad-1'))).toBe(false);
  });

  it('opens Prowlarr on its tasks, and runs only an allowed one', async () => {
    mocks.statuses = withProwlarr;
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Prowlarr.*update available/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).queryByRole('tab', { name: 'Health' })).toBeNull();
    expect(within(sheet).getByRole('tab', { name: 'Tasks', selected: true })).toBeTruthy();
    expect(await within(sheet).findByText(/v3\.1\.0\.5799 is available: update it where Prowlarr runs/)).toBeTruthy();
    expect(await within(sheet).findByText('Application Update Check')).toBeTruthy();
    // Only the allowed task has Run now.
    expect(within(sheet).getAllByRole('button', { name: /^Run .* now$/ }).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Run Check Health now']);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Run Check Health now' }));
    await waitFor(() => expect(mocks.posts).toEqual([
      { url: '/api/admin/arr-system/tasks?instanceId=pro-1', body: { name: 'CheckHealth' } },
    ]));
  });

  it('keeps a run going across tabs, so it cannot be started twice', async () => {
    mocks.statuses = withProwlarr;
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Prowlarr.*update available/ }));
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Run Check Health now' }));
    await waitFor(() => expect(mocks.posts).toHaveLength(1));
    await userEvent.click(within(sheet).getByRole('tab', { name: 'Logs' }));
    await userEvent.click(within(sheet).getByRole('tab', { name: 'Tasks' }));
    const button = await within(sheet).findByRole('button', { name: 'Run Check Health now' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(button);
    expect(mocks.posts).toHaveLength(1);
  });

  it('pages through the log, and asks for errors only when switched', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Anime.*2 health issues/ }));
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(within(sheet).getByRole('tab', { name: 'Logs' }));
    expect(await within(sheet).findByText('Entry 50')).toBeTruthy();
    expect(within(sheet).getByText('60 warning and error entries')).toBeTruthy();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Load more' }));
    expect(await within(sheet).findByText('Entry 60')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Load more' })).toBeNull();
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Errors only' }));
    await waitFor(() => expect(mocks.systemUrls).toContain('/api/admin/arr-system/logs?level=error&page=1&instanceId=son-2'));
  });

  it('shows a member only health: no versions, tasks or logs, nothing asked', async () => {
    mocks.me = { ...MEMBER, capabilities: { ...MEMBER.capabilities, 'notify.health': true, 'prowlarr.manage': true } };
    mocks.statuses = withProwlarr;
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Anime.*2 health issues/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Sonarr · Anime health')).toBeTruthy();
    expect(within(sheet).queryByRole('tab')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /Restart|Shut down/ })).toBeNull();
    expect(screen.queryByText(/update available/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Prowlarr/ })).toBeNull();
    expect(mocks.systemUrls).toEqual([]);
  });
});

describe('Service status, for admins: restart, shut down and backups', () => {
  async function openSheet() {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Anime.*2 health issues/ }));
    return screen.findByRole('dialog');
  }

  it('shuts down only after the confirmation, which says it cannot be undone from Helprr', async () => {
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole('tab', { name: 'Tasks' }));
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Shut down Sonarr' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText(/can't be undone from Helprr/)).toBeTruthy();
    expect(mocks.sent).toEqual([]);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(mocks.sent).toEqual([]);

    await userEvent.click(within(sheet).getByRole('button', { name: 'Restart Sonarr' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(mocks.sent).toEqual([
      { url: '/api/admin/arr-system/power?instanceId=son-2', method: 'POST', body: { action: 'restart' } },
    ]));
  });

  it('deletes a backup only with the typed word and the password, and shows a wrong password under it', async () => {
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole('tab', { name: 'Backups' }));
    expect(await within(sheet).findByText('Manual backup')).toBeTruthy();
    expect(within(sheet).getByText('Scheduled backup')).toBeTruthy();
    await userEvent.click(within(sheet).getAllByRole('button', { name: /^Actions for the manual backup/ })[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    const submit = within(sheet).getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await userEvent.type(within(sheet).getByPlaceholderText('DELETE'), 'delete');
    expect(submit.disabled).toBe(true);
    await userEvent.type(within(sheet).getByLabelText('Your current password'), 'pw');
    expect(submit.disabled).toBe(false);

    mocks.refusePassword = true;
    await userEvent.click(submit);
    expect(await within(sheet).findByRole('alert')).toHaveProperty('textContent', 'Current password is incorrect');
    expect(mocks.sent).toEqual([
      { url: '/api/admin/arr-system/backups/222?instanceId=son-2', method: 'DELETE', body: { currentPassword: 'pw', confirm: 'DELETE' } },
    ]);

    mocks.refusePassword = false;
    await userEvent.type(within(sheet).getByLabelText('Your current password'), '2');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));
    // Back to the list once it is done.
    expect(await within(sheet).findByText('Back up now')).toBeTruthy();
    expect(mocks.sent).toHaveLength(2);
  });

  it('restores from a picked zip with the word and password, and turns away other files in the browser', async () => {
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole('tab', { name: 'Backups' }));
    await within(sheet).findByText('Manual backup');
    const input = within(sheet).getByLabelText('Backup file to restore') as HTMLInputElement;
    await userEvent.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }), { applyAccept: false });
    expect(within(sheet).queryByText('Restore from this file?')).toBeNull();

    await userEvent.upload(input, new File(['PK'], 'sonarr_backup.zip', { type: 'application/zip' }));
    expect(await within(sheet).findByText('Restore from this file?')).toBeTruthy();
    await userEvent.type(within(sheet).getByPlaceholderText('RESTORE'), 'RESTORE');
    await userEvent.type(within(sheet).getByLabelText('Your current password'), 'pw');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(mocks.sent).toEqual([{
      url: '/api/admin/arr-system/backups/upload?instanceId=son-2',
      method: 'POST',
      // No code field without two-step sign-in.
      body: { confirm: 'RESTORE', currentPassword: 'pw', file: 'file:sonarr_backup.zip' },
    }]));
    expect(await within(sheet).findByText('Back up now')).toBeTruthy();
  });
});
