import { describe, expect, it } from 'vitest';
import { isPushServiceEndpoint, pushEndpointHost } from '@/lib/push-endpoint';

describe('isPushServiceEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/cXYZ:APA91bH-abc_123',
    'https://fcm.googleapis.com/wp/dAbC',
    'https://jmt17.google.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABl-_x=',
    'https://web.push.apple.com/QKabc-123_DEF',
    'https://wns2-by3p.notify.windows.com/w/?token=BQYAAADz%2bA%3d',
  ])('accepts %s', (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ['another host', 'https://collector.example/hook'],
    ['an internal host', 'https://sonarr.lan/api/v3/command'],
    ['an address', 'https://10.0.0.5/'],
    ['plain http', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['a port', 'https://fcm.googleapis.com:8443/fcm/send/abc'],
    ['credentials before the host', 'https://fcm.googleapis.com@collector.example/x'],
    ['a look-alike domain', 'https://notpush.apple.com/x'],
    ['a look-alike suffix', 'https://web.push.apple.com.collector.example/x'],
    ['the allowed name in the path', 'https://collector.example/.push.apple.com/'],
    ['the allowed name in the fragment', 'https://collector.example/#.push.apple.com'],
    ['a trailing dot', 'https://fcm.googleapis.com./fcm/send/abc'],
    ['an upper-case host', 'https://FCM.googleapis.com/fcm/send/abc'],
    ['no path', 'https://fcm.googleapis.com'],
    // Node's legacy parser, which web-push uses, ends the host at these, so it
    // would connect to `internal` where the WHATWG parser reads an Apple host.
    ['a tab inside the host', 'https://internal\t.push.apple.com/x'],
    ['a semicolon inside the host', 'https://internal;.push.apple.com/x'],
    ['a backslash inside the host', 'https://internal\\.push.apple.com/x'],
    ['a space in the path', 'https://web.push.apple.com/a b'],
    ['a line break', 'https://web.push.apple.com/a\nb'],
    ['something that is not a string', { href: 'https://web.push.apple.com/x' }],
    ['an empty string', ''],
    ['an oversized value', `https://web.push.apple.com/${'a'.repeat(2048)}`],
  ])('refuses %s', (_label, endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(false);
  });
});

describe('pushEndpointHost', () => {
  it('names the host of a plain https endpoint, allowed or not', () => {
    expect(pushEndpointHost('https://push.example.org/abc')).toBe('push.example.org');
    expect(pushEndpointHost('https://internal;.push.apple.com/x')).toBeNull();
  });
});
