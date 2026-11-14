// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const signedIn = vi.hoisted(() => ({ me: { role: 'admin' } as Record<string, unknown> }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => signedIn.me }));
const settingsFetch = vi.hoisted(() => ({ forgetAppSettingsFetch: vi.fn() }));
vi.mock('@/lib/app-settings-fetch', () => settingsFetch);
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
let importedCalls: unknown[];
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
      <ImportSettingsDialog open={isOpen} onOpenChange={() => {}} onImported={(warnings) => { importedCalls.push(warnings); }} />
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
  importedCalls = [];
  signedIn.me = { role: 'admin' };
  configRead = 'ok';
  settingsFetch.forgetAppSettingsFetch.mockClear();
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

it('drops the shared settings read after an import, so the next read sees the imported values', async () => {
  await open(exportFile(off, off));
  expect(settingsFetch.forgetAppSettingsFetch).not.toHaveBeenCalled();
  await click('Apply selected');
  await vi.waitFor(() => expect(settingsFetch.forgetAppSettingsFetch).toHaveBeenCalled());
  expect(imports).toHaveLength(1);
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

  it('waits for a subscription lookup still under way, so a quick Apply keeps the device rules', async () => {
    let resolveReady: (registration: unknown) => void = () => {};
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('navigator', {
      ...navigator,
      serviceWorker: { ready: new Promise((resolve) => { resolveReady = resolve; }), addEventListener: () => {}, removeEventListener: () => {} },
    });
    await render(true, newClient());
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = {
      kind: 'helprr-settings-export',
      version: 2,
      zustandVersion: STORE_VERSION,
      uiPrefs: { playback: { subtitleAppearance: { textSize: 'large' } } },
      notificationPrefs: [{ deviceName: 'iPhone', rules: [] }],
    };
    Object.defineProperty(input, 'files', { value: [new File([JSON.stringify(file)], 'helprr.json')], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await vi.waitFor(() => expect(document.body.textContent).toContain('Notification Preferences'));

    await click('Apply selected');
    expect(imports).toEqual([]);
    await act(async () => {
      resolveReady({ pushManager: { getSubscription: async () => ({ endpoint: 'https://push.example/device' }) } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(imports).toEqual([expect.objectContaining({
      notificationDevice: { deviceName: 'iPhone', rules: [] },
      currentDeviceEndpoint: 'https://push.example/device',
    })]);
  });

  async function loadDeviceFile() {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = {
      kind: 'helprr-settings-export',
      version: 2,
      zustandVersion: STORE_VERSION,
      uiPrefs: { playback: { subtitleAppearance: { textSize: 'large' } } },
      notificationPrefs: [{ deviceName: 'iPhone', rules: [] }],
    };
    Object.defineProperty(input, 'files', { value: [new File([JSON.stringify(file)], 'helprr.json')], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await vi.waitFor(() => expect(document.body.textContent).toContain('Notification Preferences'));
  }

  it('still sends the device rules when the lookup does not answer, so the server reports the skip', async () => {
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { ready: new Promise(() => {}), addEventListener: () => {}, removeEventListener: () => {} } });
    await render(true, newClient());
    await loadDeviceFile();

    await click('Apply selected');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 3200)); });

    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ notificationDevice: { deviceName: 'iPhone', rules: [] } });
    expect(imports[0]).not.toHaveProperty('currentDeviceEndpoint');
  }, 10_000);

  it('looks the subscription up afresh each time the dialog opens', async () => {
    // First opening: no push support, so no subscription.
    await render(true, newClient());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await render(false, newClient());

    // Reopened after push was enabled; Apply before the lookup answers.
    let resolveReady: (registration: unknown) => void = () => {};
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { ready: new Promise((resolve) => { resolveReady = resolve; }), addEventListener: () => {}, removeEventListener: () => {} } });
    const client = newClient();
    await render(true, client);
    await loadDeviceFile();
    await click('Apply selected');
    await act(async () => {
      resolveReady({ pushManager: { getSubscription: async () => ({ endpoint: 'https://push.example/device' }) } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(imports).toEqual([expect.objectContaining({
      notificationDevice: { deviceName: 'iPhone', rules: [] },
      currentDeviceEndpoint: 'https://push.example/device',
    })]);
  });

  it('sends the device rules when the lookup fails, so the server reports the skip', async () => {
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => { throw new DOMException('aborted', 'AbortError'); } } }), addEventListener: () => {}, removeEventListener: () => {} } });
    await render(true, newClient());
    await loadDeviceFile();

    await click('Apply selected');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ notificationDevice: { deviceName: 'iPhone', rules: [] } });
    expect(imports[0]).not.toHaveProperty('currentDeviceEndpoint');
  });

  it('ignores a lookup from an earlier opening that lands while the dialog is closed', async () => {
    let resolveFirst: (registration: unknown) => void = () => {};
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { ready: new Promise((resolve) => { resolveFirst = resolve; }), addEventListener: () => {}, removeEventListener: () => {} } });
    await render(true, newClient());
    await render(false, newClient());
    // The first opening's lookup answers "no subscription" while closed.
    await act(async () => {
      resolveFirst({ pushManager: { getSubscription: async () => null } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    let resolveSecond: (registration: unknown) => void = () => {};
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { ready: new Promise((resolve) => { resolveSecond = resolve; }), addEventListener: () => {}, removeEventListener: () => {} } });
    await render(true, newClient());
    await loadDeviceFile();
    await click('Apply selected');
    await act(async () => {
      resolveSecond({ pushManager: { getSubscription: async () => ({ endpoint: 'https://push.example/device' }) } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(imports).toEqual([expect.objectContaining({ currentDeviceEndpoint: 'https://push.example/device' })]);
  });

  it('drops an import still waiting for the lookup when the dialog is closed and reopened', async () => {
    store.applyImportedUiPrefs.mockClear();
    let resolveReady: (registration: unknown) => void = () => {};
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { ready: new Promise((resolve) => { resolveReady = resolve; }), addEventListener: () => {}, removeEventListener: () => {} } });
    await render(true, newClient());
    await loadDeviceFile();
    await click('Apply selected');
    await render(false, newClient());
    await render(true, newClient());

    await act(async () => {
      resolveReady({ pushManager: { getSubscription: async () => ({ endpoint: 'https://push.example/device' }) } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(imports).toEqual([]);
    expect(store.applyImportedUiPrefs).not.toHaveBeenCalled();
  });

  it('does not wait for the lookup when no device rules are imported', async () => {
    store.applyImportedUiPrefs.mockClear();
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { ready: new Promise(() => {}), addEventListener: () => {}, removeEventListener: () => {} } });
    await render(true, newClient());
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = { kind: 'helprr-settings-export', version: 2, zustandVersion: STORE_VERSION, uiPrefs: { playback: { subtitleAppearance: { textSize: 'large' } } } };
    Object.defineProperty(input, 'files', { value: [new File([JSON.stringify(file)], 'helprr.json')], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await vi.waitFor(() => expect(document.body.textContent).toContain('Playback'));

    await click('Apply selected');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(imports).toEqual([]);
    expect(store.applyImportedUiPrefs).toHaveBeenCalledWith({ subtitleAppearance: { textSize: 'large' } });
  });

  it('drops an import still waiting for the lookup when the page goes away', async () => {
    store.applyImportedUiPrefs.mockClear();
    let resolveReady: (registration: unknown) => void = () => {};
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { ready: new Promise((resolve) => { resolveReady = resolve; }), addEventListener: () => {}, removeEventListener: () => {} } });
    await render(true, newClient());
    await loadDeviceFile();
    await click('Apply selected');
    await act(async () => root.unmount());

    await act(async () => {
      resolveReady({ pushManager: { getSubscription: async () => ({ endpoint: 'https://push.example/device' }) } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(imports).toEqual([]);
    expect(store.applyImportedUiPrefs).not.toHaveBeenCalled();
    // afterEach unmounts again.
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById('root')!);
  });
});

describe('importing user accounts asks for your password, and a code while your two-step sign-in is on', () => {
  const withUsers = () => ({
    ...exportFile(off, off),
    users: { accounts: [{ username: 'other', displayName: 'Other', role: 'admin', status: 'active', template: 'admin', permissions: {} }] },
  });
  const field = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  const confirmButton = () =>
    [...document.querySelectorAll('[role="dialog"] button')].find((el) => el.textContent?.trim() === 'Continue') as HTMLButtonElement;

  async function stubTwoStep(enabled: boolean, refuseFirst = false) {
    const base = vi.mocked(fetch).getMockImplementation()!;
    let refused = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/me/totp') return new Response(JSON.stringify({ available: true, enabled, recoveryCodesLeft: 8 }));
      if (url === '/api/settings/import' && refuseFirst && !refused) {
        refused = true;
        imports.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ error: 'Importing user accounts needs your current password.', needsStepUp: true, needsCode: false }), { status: 403 });
      }
      return base(url, init);
    }));
  }

  it('asks in the confirm step, and sends them with the users', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    await stubTwoStep(true);
    await open(withUsers());
    await click('Replace everything');
    await vi.waitFor(() => expect(field('Authenticator or recovery code')).not.toBeNull());
    expect(confirmButton().disabled).toBe(true);
    await userEvent.type(field('Your current password')!, 'my password');
    expect(confirmButton().disabled).toBe(true);
    await userEvent.type(field('Authenticator or recovery code')!, '123456');
    await act(async () => { confirmButton().click(); });
    await vi.waitFor(() => expect(imports).toHaveLength(1));
    expect(imports[0]).toMatchObject({ users: expect.any(Object), currentPassword: 'my password', code: '123456' });
  });

  it('a Jellyfin change the server asks about brings the confirm step back with the fields', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    await stubTwoStep(false, true);
    await open({ ...exportFile(off, off), serviceConnections: [{ type: 'JELLYFIN', label: 'Jellyfin', url: 'http://new.lan:8096', apiKey: null }] });
    await click('Apply selected');
    await vi.waitFor(() => expect(imports).toHaveLength(1));
    await vi.waitFor(() => expect(field('Your current password')).not.toBeNull());
    await userEvent.type(field('Your current password')!, 'my password');
    await act(async () => { confirmButton().click(); });
    await vi.waitFor(() => expect(imports).toHaveLength(2));
    expect(imports[1]).toMatchObject({ serviceConnections: [expect.objectContaining({ type: 'JELLYFIN' })], currentPassword: 'my password' });
  });

  it('asks for nothing when the users are left out', async () => {
    await stubTwoStep(true);
    await open(withUsers());
    await click('Apply selected');
    await vi.waitFor(() => expect(imports).toHaveLength(1));
    expect(imports[0]).not.toHaveProperty('users');
    expect(imports[0]).not.toHaveProperty('currentPassword');
  });

  it('asks for the password alone when the server says so (a stale two-step state)', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    await stubTwoStep(true, true);
    await open(withUsers());
    await click('Replace everything');
    await vi.waitFor(() => expect(field('Your current password')).not.toBeNull());
    await userEvent.type(field('Your current password')!, 'wrong');
    await userEvent.type(field('Authenticator or recovery code')!, '123456');
    await act(async () => { confirmButton().click(); });
    await vi.waitFor(() => expect(imports).toHaveLength(1));
    // The server's answer wins: the confirm step comes back, asking for the password only.
    await vi.waitFor(() => expect(field('Your current password')).not.toBeNull());
    expect(field('Authenticator or recovery code')).toBeNull();
  });
});

describe('choosing how user accounts are imported', () => {
  const FIRST_ADMIN = 'user-bootstrap-admin';
  const withUsers = (...extra: object[]) => ({
    ...exportFile(off, off),
    users: { accounts: [
      { id: FIRST_ADMIN, username: 'owner', displayName: 'Owner', role: 'admin', status: 'active', template: 'admin', permissions: {}, passwordHash: 'scrypt$hash' },
      { id: 'other-1', username: 'admin', displayName: 'Admin', role: 'member', status: 'active', template: 'member', permissions: {} },
      ...extra,
    ] },
  });
  // This install: its first admin "admin" and the admin "boss".
  let localUsers: Response | (() => Response);
  const radio = (title: string) =>
    [...document.querySelectorAll('[role="radio"]')].find((el) => el.textContent?.startsWith(title)) as HTMLButtonElement;
  const warnings = () => [...document.querySelectorAll('[role="radiogroup"] + div p')].map((el) => el.textContent);
  const choose = (title: string) => act(async () => { radio(title).click(); });

  beforeEach(() => {
    localUsers = () => new Response(JSON.stringify([{ id: FIRST_ADMIN, username: 'admin' }, { id: 'boss-id', username: 'boss' }]));
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/me/totp') return new Response(JSON.stringify({ available: true, enabled: false, recoveryCodesLeft: 0 }));
      if (url === '/api/users') return typeof localUsers === 'function' ? localUsers() : localUsers;
      return base(url, init);
    }));
  });

  async function openRead(file: object) {
    await open(file);
    // This install's accounts are read.
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/users')).toBe(true));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }

  async function importWith(response: object) {
    const { default: userEvent } = await import('@testing-library/user-event');
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url === '/api/settings/import'
      ? new Response(JSON.stringify(response))
      : base(url, init)));
    await click('Replace everything');
    await vi.waitFor(() => expect(document.querySelector('input[aria-label="Your current password"]')).not.toBeNull());
    await userEvent.type(document.querySelector<HTMLInputElement>('input[aria-label="Your current password"]')!, 'pw');
    await click('Continue');
  }

  it("preselects keeping this install's first admin, explains each choice, and sends the mode with the users", async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    signedIn.me = { role: 'admin', id: FIRST_ADMIN, username: 'admin' };
    await openRead(withUsers());
    expect([...document.querySelectorAll('[role="radio"]')].map((el) => el.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(radio("Keep this install's first admin").textContent).toContain('the rest added. This install\'s first admin is never changed');
    expect(warnings()).toEqual([]);

    await click('Replace everything');
    await vi.waitFor(() => expect(document.querySelector('input[aria-label="Your current password"]')).not.toBeNull());
    expect(document.body.textContent).toContain("User accounts: Keep this install's first admin");
    await userEvent.type(document.querySelector<HTMLInputElement>('input[aria-label="Your current password"]')!, 'pw');
    await click('Continue');
    await vi.waitFor(() => expect(imports).toHaveLength(1));
    expect(imports[0]).toMatchObject({ usersMode: 'keep-first-admin', users: expect.any(Object) });
  });

  it('warns the first admin that Restore renames them, gives them the file password and signs them out', async () => {
    signedIn.me = { role: 'admin', id: FIRST_ADMIN, username: 'admin' };
    await openRead(withUsers());
    await choose('Restore');
    expect(warnings()).toEqual([expect.stringContaining('you become “owner” with the file\'s password, and are signed out now')]);
    // Matching by username reaches them through the file's "admin", which has no password.
    await choose('Match by username');
    expect(warnings()).toEqual(['This updates your own account from the file. Your role and password stay.']);
  });

  it('does not promise a renamed importer that nothing else changes: a sign-in proxy must send the new name', async () => {
    signedIn.me = { role: 'admin', id: FIRST_ADMIN, username: 'admin' };
    await openRead({ ...exportFile(off, off), users: { accounts: [{ id: FIRST_ADMIN, username: 'owner', role: 'admin', status: 'active', template: 'admin', permissions: {} }] } });
    await choose('Restore');
    expect(warnings()[0]).toContain('its username becomes “owner”, and your password stays. A sign-in proxy must then send “owner”: until it does, you are signed out.');
    expect(warnings()[0]).not.toContain('from now on');
  });

  it("Restore by the first admin, when the file's first-admin name is already another account's, warns about the entry that really reaches them", async () => {
    localUsers = () => new Response(JSON.stringify([{ id: FIRST_ADMIN, username: 'admin' }, { id: 'o', username: 'owner' }]));
    signedIn.me = { role: 'admin', id: FIRST_ADMIN, username: 'admin' };
    await openRead(withUsers());
    await choose('Restore');
    expect(warnings()).toEqual(['This updates your own account from the file. Your role and password stay.']);
  });

  it("tells another admin what Restore and Match do to this install's first admin", async () => {
    signedIn.me = { role: 'admin', id: 'boss-id', username: 'boss' };
    await openRead(withUsers());
    await choose('Restore');
    expect(warnings()).toEqual(['This install\'s first admin “admin” becomes “owner” with the file\'s password, and is signed out if it differs.']);
    // The file's "admin" has this install's first admin's username.
    await choose('Match by username');
    expect(warnings()).toEqual(['This install\'s first admin “admin” is updated from the file. It stays an admin.']);
    await choose("Keep this install's first admin");
    expect(warnings()).toEqual([]);
  });

  it('shows both warnings when another admin in the file restores: theirs and the first admin\'s', async () => {
    signedIn.me = { role: 'admin', id: 'boss-id', username: 'boss' };
    await openRead(withUsers({ id: 'boss-elsewhere', username: 'boss', role: 'admin', status: 'active', template: 'admin', permissions: {}, passwordHash: 'scrypt$b' }));
    await choose('Restore');
    expect(warnings()).toEqual([
      expect.stringContaining('This changes your own account: it gets the file\'s password'),
      expect.stringContaining('This install\'s first admin “admin” becomes “owner”'),
    ]);
  });

  it("cautions another admin choosing Match when this install's accounts cannot be read", async () => {
    localUsers = () => new Response(null, { status: 500 });
    signedIn.me = { role: 'admin', id: 'boss-id', username: 'boss' };
    await openRead(withUsers());
    await choose('Match by username');
    expect(warnings()).toEqual([expect.stringContaining("If the file has an account with this install's first admin's username")]);
  });

  it('keeps the signed-out message up with the new username and the notes, and a 401 meanwhile does not load Sign in', async () => {
    const { toast } = await import('sonner');
    const { handleAuthError } = await import('@/lib/query-client');
    const { ApiError } = await import('@/lib/query-fetch');
    signedIn.me = { role: 'admin', id: FIRST_ADMIN, username: 'admin' };
    await openRead(withUsers());
    await choose('Restore');
    await importWith({
      skipped: ['User "bob" skipped: username already belongs to another account'],
      warnings: [{ task: 'cleanupSchedulers', message: 'Schedulers did not restart.' }],
      importerSignedOut: { username: 'owner', renamedBehindProxy: false },
    });
    await vi.waitFor(() => expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
      expect.stringContaining('Sign in as “owner” with the imported password'),
      expect.objectContaining({ duration: Infinity, action: expect.objectContaining({ label: 'Sign in' }) }),
    ));
    const [, options] = vi.mocked(toast.warning).mock.calls.at(-1)! as [string, { description: React.ReactElement }];
    const list = document.createElement('div');
    const listRoot = createRoot(list);
    await act(async () => listRoot.render(options.description));
    expect(list.textContent).toContain('username already belongs to another account');
    expect(list.textContent).toContain('Schedulers did not restart.');
    await act(async () => listRoot.unmount());
    expect(importedCalls).toHaveLength(0);

    // The badge poll's 401 (or any query's) goes through handleAuthError.
    const assign = vi.fn();
    const realWindow = window;
    vi.stubGlobal('window', new Proxy(realWindow, {
      get: (target, key) => (key === 'location' ? { pathname: '/settings/backup', search: '', hash: '', assign } : Reflect.get(target, key)),
    }));
    try {
      handleAuthError(new ApiError(401, 'GET /api/badges → 401'));
    } finally {
      vi.stubGlobal('window', realWindow);
    }
    expect(assign).not.toHaveBeenCalled();
  });

  it('says the proxy must send the new username when a rename ended a proxy session', async () => {
    const { toast } = await import('sonner');
    signedIn.me = { role: 'admin', id: FIRST_ADMIN, username: 'admin' };
    await openRead(withUsers());
    await choose('Restore');
    await importWith({ skipped: [], warnings: [], importerSignedOut: { username: 'owner', renamedBehindProxy: true } });
    await vi.waitFor(() => expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
      expect.stringContaining('Your username is now “owner”, so you are signed out. Have your sign-in proxy send it'),
      expect.anything(),
    ));
  });

  it('does not send a mode when the users are left out', async () => {
    await open(withUsers());
    await click('Apply selected');
    await vi.waitFor(() => expect(imports).toHaveLength(1));
    expect(imports[0]).not.toHaveProperty('usersMode');
  });
});
