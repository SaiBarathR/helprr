import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(join(process.cwd(), 'public/offline.html'), 'utf8');

describe('offline document', () => {
  it('retries by itself so it does not stay on "You\'re offline" after reconnecting', () => {
    expect(html).toMatch(/<meta\s+http-equiv="refresh"\s+content="\d+"/i);
  });

  it('carries no script, which the nonce CSP it is served with would block', () => {
    expect(html).not.toMatch(/<script/i);
  });
});
