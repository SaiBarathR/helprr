import { describe, expect, it } from 'vitest';
import { parseIosVersion, pushReadinessChecks, type PushFacts } from '@/lib/push-readiness';

const ready: PushFacts = {
  secure: true,
  origin: 'https://helprr.example.com',
  supported: true,
  ios: false,
  iosVersion: null,
  standalone: true,
  serverConfigured: true,
  admin: true,
  workerActive: true,
  permission: 'granted',
  subscribed: true,
};

const byId = (facts: PushFacts) => Object.fromEntries(pushReadinessChecks(facts).map((check) => [check.id, check]));

describe('pushReadinessChecks', () => {
  it('is all ok when everything is ready', () => {
    const checks = pushReadinessChecks(ready);
    expect(checks.map((check) => check.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(checks.map((check) => check.id)).toEqual(['secure', 'server', 'installed', 'worker', 'permission', 'subscribed']);
    expect(checks.every((check) => !check.detail)).toBe(true);
  });

  it('blames plain HTTP by its address, and cannot ask the browser the rest', () => {
    const checks = byId({ ...ready, secure: false, origin: 'http://192.168.1.10:3050', supported: false, standalone: false });
    expect(checks.secure.state).toBe('fail');
    expect(checks.secure.detail).toContain('http://192.168.1.10:3050');
    expect(checks.worker).toMatchObject({ state: 'skip', detail: 'Needs a secure address first.' });
    expect(checks.permission.state).toBe('skip');
    expect(checks.subscribed.state).toBe('skip');
  });

  it('tells an admin what the server lacks and a member to ask', () => {
    expect(byId({ ...ready, serverConfigured: false, serverMissing: ['VAPID_PRIVATE_KEY'] }).server.detail).toContain('VAPID_PRIVATE_KEY');
    expect(byId({ ...ready, serverConfigured: false, admin: false }).server.detail).toBe(
      'Ask your Helprr admin to turn on push notifications for this server.',
    );
    expect(byId({ ...ready, serverConfigured: null }).server.state).toBe('checking');
  });

  it('needs the installed app and iOS 16.4 on an iPhone', () => {
    const browser = byId({ ...ready, ios: true, iosVersion: [17, 2], standalone: false });
    expect(browser.installed).toMatchObject({ state: 'fail', fixHref: '/settings/appearance#install' });
    expect(browser['ios-version']).toMatchObject({ state: 'ok', title: 'iOS 17.2' });
    expect(byId({ ...ready, ios: true, iosVersion: [16, 3] })['ios-version'].state).toBe('fail');
    expect(byId({ ...ready, ios: true, iosVersion: [16, 4] })['ios-version'].state).toBe('ok');
    expect(byId({ ...ready, ios: true, iosVersion: null })['ios-version'].state).toBe('warn');
    expect(byId(ready)['ios-version']).toBeUndefined();
  });

  it('counts the browser as fine outside iOS, where installing is optional', () => {
    expect(byId({ ...ready, standalone: false }).installed).toMatchObject({ state: 'ok', title: 'Opened in the browser (installing is optional here)' });
  });

  it('fails a secure browser without push, but leaves an iPhone waiting for install to its own row', () => {
    const checks = byId({ ...ready, supported: false });
    expect(checks.browser).toMatchObject({ state: 'fail', title: 'This browser cannot do push' });
    expect(pushReadinessChecks({ ...ready, supported: false }).filter((check) => check.state === 'fail')).toHaveLength(1);
    expect(byId({ ...ready, supported: false, ios: true, iosVersion: [18, 0], standalone: false }).browser).toBeUndefined();
    expect(byId({ ...ready, supported: false, secure: false }).browser).toBeUndefined();
  });

  it('does not blame the server when it could not be asked', () => {
    expect(byId({ ...ready, serverConfigured: null, serverUnreachable: true }).server).toMatchObject({
      state: 'warn',
      title: 'Could not reach Helprr to check its push keys',
    });
  });

  it("puts the push hook's own reason first on an unsubscribed device", () => {
    expect(byId({ ...ready, subscribed: false, deviceError: 'Turn notifications on again on this device.' }).subscribed.detail).toMatch(
      /^Turn notifications on again on this device\. Turn it on/,
    );
  });

  it('names a stopped service worker, a blocked or unasked permission, and an unsubscribed device', () => {
    expect(byId({ ...ready, workerActive: false }).worker.state).toBe('fail');
    expect(byId({ ...ready, workerActive: null }).worker.state).toBe('checking');
    expect(byId({ ...ready, permission: 'denied', ios: true, iosVersion: [18, 0] }).permission.detail).toContain('Settings → Notifications → Helprr');
    expect(byId({ ...ready, permission: 'denied' }).permission.detail).toContain('site settings');
    expect(byId({ ...ready, permission: 'default' }).permission.state).toBe('warn');
    expect(byId({ ...ready, subscribed: false }).subscribed).toMatchObject({ state: 'fail', fixHref: '/settings/notifications' });
  });

  it('says why a secure browser without push cannot go on', () => {
    expect(byId({ ...ready, supported: false }).worker.detail).toBe('This browser cannot do push.');
    // iPhone Safari hides push until Helprr is installed.
    expect(byId({ ...ready, supported: false, ios: true, iosVersion: [18, 0], standalone: false }).worker.detail).toBe('Needs the installed app first.');
  });
});

describe('parseIosVersion', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1', [17, 4]],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 16_3_1 like Mac OS X) AppleWebKit/605.1.15', [16, 3]],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', [18, 1]],
    ['Mozilla/5.0 (Linux; Android 14)', null],
  ])('%s', (userAgent, expected) => {
    expect(parseIosVersion(userAgent)).toEqual(expected);
  });
});
