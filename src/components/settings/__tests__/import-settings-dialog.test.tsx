// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => ({ role: 'admin' }) }));
const store = vi.hoisted(() => ({ applyImportedUiPrefs: vi.fn(), setDiscoverLayout: vi.fn() }));
vi.mock('@/lib/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/store')>()),
  useUIStore: (select: (state: object) => unknown) => select(store),
}));

import { STORE_VERSION } from '@/lib/store';
import { ImportSettingsDialog } from '../import-settings-dialog';

type Cleaner = { enabled: boolean; autoRunMode: string };
let current: { queue: Cleaner; download: Cleaner };
let imports: unknown[];
let configRead: 'ok' | 'fails' | 'hangs' | 'held';
let releaseHeld: () => void;
let root: Root;

const off: Cleaner = { enabled: false, autoRunMode: 'disabled' };
const deleting: Cleaner = { enabled: true, autoRunMode: 'enabled' };

function exportFile(queue: Cleaner, download: Cleaner) {
  return {
    kind: 'helprr-settings-export',
    version: 2,
    cleanup: {
      queueConfig: { ...queue, intervalMinutes: 30 },
      downloadConfig: { ...download, intervalMinutes: 60 },
      stallRules: [],
      slowRules: [],
      seedingRules: [],
    },
  };
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function render(isOpen: boolean, client: QueryClient) {
  return act(async () => root.render(
    <QueryClientProvider client={client}>
      <ImportSettingsDialog open={isOpen} onOpenChange={() => {}} onImported={() => {}} />
    </QueryClientProvider>,
  ));
}

async function open(file: object, client = newClient()) {
  await render(true, client);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [new File([JSON.stringify(file)], 'helprr.json')], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await vi.waitFor(() => expect(document.body.textContent).toContain('Replaces existing rules'));
  // Let the current cleaner state load.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const button = (label: string, scope = 'body') =>
  [...document.querySelectorAll(`${scope} button`)].find((el) => el.textContent?.trim() === label) as HTMLButtonElement;
const click = (label: string) => act(async () => { button(label).click(); });
// The import dialog has a Cancel of its own.
const answer = (label: string) => act(async () => { button(label, '[role="alertdialog"]').click(); });
const confirmTitle = () => document.querySelector('[role="alertdialog"] h2')?.textContent ?? null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  current = { queue: off, download: off };
  imports = [];
  configRead = 'ok';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith('/config') && configRead === 'fails') return new Response(null, { status: 503 });
    if (url.endsWith('/config') && configRead === 'hangs') return new Promise<Response>(() => {});
    if (url === '/api/cleanup/download/config' && configRead === 'held') {
      // Answers later with the state at the time it was asked.
      const state = current.download;
      return new Promise<Response>((resolve) => { releaseHeld = () => resolve(json(state)); });
    }
    if (url === '/api/cleanup/queue/config') return json(current.queue);
    if (url === '/api/cleanup/download/config') return json(current.download);
    if (url.startsWith('/api/cleanup/history')) return json({ total: 1 });
    if (url === '/api/settings/import') {
      imports.push(JSON.parse(String(init?.body)));
      return json({ skipped: [], warnings: [] });
    }
    return new Response(null, { status: 404 });
  }));
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('importing a cleanup section', () => {
  it('asks before turning on automatic deletion, and Cancel imports nothing', async () => {
    await open(exportFile(deleting, off));
    expect(document.body.textContent).toContain('Turns on automatic deletion for the Queue Cleaner.');

    await click('Apply selected');
    expect(confirmTitle()).toBe('Turn on automatic deletion for the Queue Cleaner?');
    await answer('Cancel');
    expect(confirmTitle()).toBeNull();
    expect(imports).toHaveLength(0);

    await click('Apply selected');
    await answer('Turn on and save');
    await vi.waitFor(() => expect(imports).toHaveLength(1));
    expect(imports[0]).toMatchObject({ cleanup: { queueConfig: { enabled: true, autoRunMode: 'enabled' } } });
  });

  it('asks for each cleaner it turns on, one after the other', async () => {
    await open(exportFile(deleting, deleting));
    expect(document.body.textContent).toContain('Turns on automatic deletion for the Queue Cleaner and Download Cleaner.');

    await click('Replace everything');
    expect(confirmTitle()).toBe('Turn on automatic deletion for the Queue Cleaner?');
    await answer('Turn on and save');
    expect(confirmTitle()).toBe('Turn on automatic deletion for the Download Cleaner?');
    expect(imports).toHaveLength(0);
    await answer('Turn on and save');
    await vi.waitFor(() => expect(imports).toHaveLength(1));
  });

  it('does not ask when deletion stays off or is already on', async () => {
    current = { queue: deleting, download: off };
    await open(exportFile(deleting, { enabled: true, autoRunMode: 'dryRun' }));
    expect(document.body.textContent).not.toContain('Turns on automatic deletion');

    await click('Apply selected');
    expect(confirmTitle()).toBeNull();
    await vi.waitFor(() => expect(imports).toHaveLength(1));
  });

  it('asks while the cleaners are read, or after a read fails, whatever an earlier read said', async () => {
    const client = newClient();
    current = { queue: deleting, download: off };
    await open(exportFile(deleting, off), client);
    expect(document.body.textContent).not.toContain('Turns on automatic deletion');

    // Reopened after the cleaner was switched off elsewhere; the new read fails.
    await render(false, client);
    current = { queue: off, download: off };
    configRead = 'fails';
    await open(exportFile(deleting, off), client);
    await click('Apply selected');
    expect(confirmTitle()).toBe('Turn on automatic deletion for the Queue Cleaner?');
    await answer('Cancel');

    // Or the new read has not finished.
    await render(false, client);
    configRead = 'hangs';
    await open(exportFile(deleting, off), client);
    await click('Apply selected');
    expect(confirmTitle()).toBe('Turn on automatic deletion for the Queue Cleaner?');
    await answer('Cancel');
    expect(imports).toHaveLength(0);
  });

  it('does not let a read from an earlier opening answer for this one', async () => {
    const client = newClient();
    current = { queue: deleting, download: off };
    configRead = 'held';
    await open(exportFile(deleting, off), client);
    await render(false, client);

    // Switched off elsewhere while closed; the earlier read finishes after reopening.
    current = { queue: off, download: off };
    configRead = 'ok';
    await open(exportFile(deleting, off), client);
    await act(async () => { releaseHeld(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await click('Apply selected');
    expect(confirmTitle()).toBe('Turn on automatic deletion for the Queue Cleaner?');
    await answer('Cancel');
    expect(imports).toHaveLength(0);
  });

  it('asks while a read waits to go online', async () => {
    const client = newClient();
    current = { queue: deleting, download: off };
    await open(exportFile(deleting, off), client);
    await render(false, client);

    onlineManager.setOnline(false);
    try {
      await open(exportFile(deleting, off), client);
      await click('Apply selected');
      expect(confirmTitle()).toBe('Turn on automatic deletion for the Queue Cleaner?');
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('does not ask when the cleanup section is left out', async () => {
    await open(exportFile(deleting, off));
    await act(async () => {
      document.querySelector<HTMLButtonElement>('section button[role="checkbox"][data-state="checked"]')!.click();
    });

    await click('Apply selected');
    expect(confirmTitle()).toBeNull();
  });

  it('imports UI preferences alone when this browser has no push subscription', async () => {
    store.applyImportedUiPrefs.mockClear();
    const subtitleAppearance = { textSize: 'large', textColor: '#ffff00' };
    await render(true, newClient());
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = {
      kind: 'helprr-settings-export',
      version: 2,
      zustandVersion: STORE_VERSION,
      uiPrefs: { playback: { subtitleAppearance } },
      notificationPrefs: [{ deviceName: 'iPhone', rules: [] }],
    };
    Object.defineProperty(input, 'files', { value: [new File([JSON.stringify(file)], 'helprr.json')], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await vi.waitFor(() => expect(document.body.textContent).toContain('Notification Preferences'));

    await click('Apply selected');

    expect(imports).toEqual([]);
    expect(store.applyImportedUiPrefs).toHaveBeenCalledWith({ subtitleAppearance });
  });
});
