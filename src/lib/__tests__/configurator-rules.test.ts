import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isLocalHostname } from '@/lib/local-hostname';

// The install configurator (docs-site, which the image leaves out) repeats this rule in
// plain JavaScript; loaded by path so the app's own type check never needs docs-site.
const configurator = pathToFileURL(path.join(process.cwd(), 'docs-site/src/lib/configurator.mjs')).href;

describe('install configurator', () => {
  it('offers the first admin only where Helprr accepts it', async () => {
    const { isLocalHostname: configuratorRule } = (await import(/* @vite-ignore */ configurator)) as { isLocalHostname: (host: string) => boolean };
    for (const host of ['192.168.1.10', 'nas', 'NAS.lan', 'box.local', 'h.home.arpa', 'x.internal', 'localhost', '[::1]', 'nas.example.com', 'helprr.mydomain.org', 'a.b', '203.0.113.5', '8.8.8.8', '100.101.1.2', '[2606:4700::1]', '[fd00::1]']) {
      expect(configuratorRule(host), host).toBe(isLocalHostname(host));
    }
  });
});
