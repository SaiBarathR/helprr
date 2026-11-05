import { describe, expect, it } from 'vitest';
import { isLocalHostname } from '@/lib/local-hostname';
// The install configurator (docs-site) repeats this rule in plain JavaScript.
import { isLocalHostname as configuratorRule } from '../../../docs-site/src/lib/configurator.mjs';

describe('install configurator', () => {
  it('offers the first admin only where Helprr accepts it', () => {
    for (const host of ['192.168.1.10', 'nas', 'NAS.lan', 'box.local', 'h.home.arpa', 'x.internal', 'localhost', '[::1]', 'nas.example.com', 'helprr.mydomain.org', 'a.b']) {
      expect(configuratorRule(host), host).toBe(isLocalHostname(host));
    }
  });
});
