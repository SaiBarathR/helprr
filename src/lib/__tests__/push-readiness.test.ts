import { describe, expect, it } from 'vitest';
import { parseIosVersion, pushReadinessChecks, quietHoursFact, type PushFacts } from '@/lib/push-readiness';

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
    expect(browser['ios-version']).toMatchObject({ state: 'ok', title: 'iOS supports push' });
    expect(byId({ ...ready, ios: true, iosVersion: [16, 3] })['ios-version'].state).toBe('fail');
    expect(byId({ ...ready, ios: true, iosVersion: [16, 4] })['ios-version'].state).toBe('ok');
    // No number when it passes: the installed app's user agent can carry the frozen 18.x.
    expect(byId({ ...ready, ios: true, iosVersion: [18, 7] })['ios-version'].title).toBe('iOS supports push');
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

  it('blames old or unknown iOS once, not twice, and never tells the installed app to install', () => {
    const old = pushReadinessChecks({ ...ready, ios: true, iosVersion: [16, 3], supported: false });
    expect(old.filter((check) => check.state === 'fail').map((check) => check.id)).toEqual(['ios-version']);
    expect(byId({ ...ready, ios: true, iosVersion: null, supported: false }).browser).toBeUndefined();
    expect(byId({ ...ready, ios: true, iosVersion: [18, 0], supported: false }).browser?.detail).toContain('Update iOS');
  });

  it('waits for the service worker before blaming the device, and ends a reason with a full stop', () => {
    expect(byId({ ...ready, workerActive: false, subscribed: false }).subscribed).toMatchObject({ state: 'skip', detail: 'Needs the service worker first.' });
    expect(byId({ ...ready, subscribed: false, deviceError: 'Service worker registration timed out' }).subscribed.detail).toMatch(
      /^Service worker registration timed out\. Turn it on/,
    );
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
    // iOS 27 Safari: the OS token is frozen at 18_7; Version/ is the real one.
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1', [27, 0]],
    ['Mozilla/5.0 (Linux; Android 14)', null],
  ])('%s', (userAgent, expected) => {
    expect(parseIosVersion(userAgent)).toEqual(expected);
  });
});

describe('quiet hours', () => {
  const settings = { quietHoursEnabled: true, quietHoursStart: 12, quietHoursEnd: 18, timeZone: null, serverTimeZone: 'Asia/Kolkata' };

  it('is on at 12:08 in India (06:38 UTC) and off at 18:08', () => {
    expect(quietHoursFact(settings, new Date('2026-11-13T06:38:00Z'))).toEqual({ start: 12, end: 18, activeNow: true });
    expect(quietHoursFact(settings, new Date('2026-11-13T12:38:00Z'))?.activeNow).toBe(false);
  });

  it('crosses midnight, and is nothing when off or zero-length', () => {
    const night = { ...settings, quietHoursStart: 23, quietHoursEnd: 7, timeZone: 'UTC' };
    expect(quietHoursFact(night, new Date('2026-11-13T02:00:00Z'))?.activeNow).toBe(true);
    expect(quietHoursFact(night, new Date('2026-11-13T12:00:00Z'))?.activeNow).toBe(false);
    expect(quietHoursFact({ ...settings, quietHoursEnabled: false }, new Date())).toBeNull();
    expect(quietHoursFact({ ...settings, quietHoursEnd: 12 }, new Date())).toBeNull();
  });

  it('warns while they are on, and says so when they are off', () => {
    const on = byId({ ...ready, quietHours: { start: 12, end: 18, activeNow: true } })['quiet-hours'];
    expect(on).toMatchObject({ state: 'warn', title: 'Quiet hours are on now', fixHref: '/settings/notifications#quiet-hours' });
    expect(byId({ ...ready, quietHours: { start: 12, end: 18, activeNow: false } })['quiet-hours'].state).toBe('ok');
    expect(byId({ ...ready, quietHours: null })['quiet-hours']).toBeUndefined();
  });
});
