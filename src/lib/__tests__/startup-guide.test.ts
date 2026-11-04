import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '@/lib/password';

const mocks = vi.hoisted(() => ({ sessions: vi.fn(), admin: vi.fn(), localAdmins: vi.fn() }));
vi.mock('@/lib/db', () => ({
  prisma: { session: { count: mocks.sessions }, user: { findUnique: mocks.admin, count: mocks.localAdmins } },
}));
vi.mock('@/lib/bootstrap-admin', () => ({ BOOTSTRAP_ADMIN_ID: 'user-bootstrap-admin' }));

import { logStartupGuide, startupGuideLines } from '@/lib/startup-guide';

const APP_PASSWORD = 'a-long-bootstrap-password-1';
let printed: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  printed = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => { printed.push(line); });
  vi.stubEnv('APP_PASSWORD', APP_PASSWORD);
  vi.stubEnv('PORT', '3050');
  vi.stubEnv('HELPRR_RUNTIME', 'docker');
  mocks.sessions.mockResolvedValue(0);
  mocks.localAdmins.mockResolvedValue(0);
});
afterEach(() => vi.unstubAllEnvs());

async function bootstrap(overrides: Record<string, unknown> = {}) {
  mocks.admin.mockResolvedValue({ username: 'boss', passwordHash: await hashPassword(APP_PASSWORD), role: 'admin', status: 'active', ...overrides });
}

describe('startupGuideLines', () => {
  it('tells a Docker installer the address to open', () => {
    expect(startupGuideLines({ port: '3050', inDocker: true, signIn: { kind: 'admin-account' } })[0])
      .toBe('[Helprr] Ready. Open http://YOUR-SERVER:3050 (or the host port you published for it) in a browser.');
  });

  it('gives a host-run Node process its local address', () => {
    expect(startupGuideLines({ port: '3050', inDocker: false, signIn: { kind: 'admin-account' } })[0])
      .toBe('[Helprr] Ready. Open http://localhost:3050 in a browser.');
  });
});

describe('logStartupGuide', () => {
  it('names APP_PASSWORD while it still signs the admin in, and never prints it', async () => {
    await bootstrap();
    await logStartupGuide();
    expect(printed[1]).toBe('[Helprr] Sign in as "boss" with the APP_PASSWORD from your .env file.');
    expect(printed.join('\n')).not.toContain(APP_PASSWORD);
    expect(printed.join('\n')).not.toContain('scrypt');
  });

  it('stops naming APP_PASSWORD once the admin changed the password in the app', async () => {
    mocks.admin.mockResolvedValue({ username: 'boss', passwordHash: await hashPassword('changed-in-the-app-1234'), role: 'admin', status: 'active' });
    mocks.localAdmins.mockResolvedValue(1);
    await logStartupGuide();
    expect(printed[1]).toBe('[Helprr] Sign in with your admin account.');
  });

  it.each([
    ['disabled', { status: 'disabled' }],
    ['demoted', { role: 'member' }],
  ])('does not send people to a %s bootstrap admin', async (_label, overrides) => {
    await bootstrap(overrides);
    mocks.localAdmins.mockResolvedValue(1);
    await logStartupGuide();
    expect(printed[1]).toBe('[Helprr] Sign in with your admin account.');
  });

  it('points to another admin when the bootstrap admin was deleted', async () => {
    mocks.admin.mockResolvedValue(null);
    mocks.localAdmins.mockResolvedValue(1);
    await logStartupGuide();
    expect(printed[1]).toBe('[Helprr] Sign in with your admin account.');
  });

  it('says APP_PASSWORD made no admin when it is set but nothing can sign in', async () => {
    mocks.admin.mockResolvedValue(null);
    await logStartupGuide();
    expect(printed[1]).toMatch(/^\[Helprr\] No admin can sign in yet: APP_PASSWORD did not create one/);
  });

  it('asks for APP_PASSWORD when it is not set', async () => {
    vi.stubEnv('APP_PASSWORD', '');
    mocks.admin.mockResolvedValue(null);
    await logStartupGuide();
    expect(printed[1]).toBe('[Helprr] No admin can sign in yet: set APP_PASSWORD in your .env file, then restart Helprr.');
  });

  it('reads the port it runs on', async () => {
    vi.stubEnv('PORT', '4000');
    await bootstrap();
    await logStartupGuide();
    expect(printed[0]).toContain('http://YOUR-SERVER:4000');
  });

  it('stays quiet once someone has signed in', async () => {
    mocks.sessions.mockResolvedValue(1);
    await logStartupGuide();
    expect(printed).toEqual([]);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
});
