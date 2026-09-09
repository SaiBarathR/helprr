import { describe, expect, it } from 'vitest';
import { cacheShellResponse, matchingShellResponse } from './shell-cache';

describe('HTML build compatibility', () => {
  it('keeps same-build offline pages and rejects obsolete or unstamped pages', async () => {
    const html = new Response('<html>shell</html>', { headers: { 'content-type': 'text/html' } });
    const cached = cacheShellResponse(html, 'build-a')!;
    expect(await matchingShellResponse(cached, 'build-a')!.text()).toBe('<html>shell</html>');
    expect(matchingShellResponse(cached, 'build-b')).toBeNull();
    expect(matchingShellResponse(html, 'build-a')).toBeNull();
    expect(matchingShellResponse(undefined, 'build-a')).toBeNull();
  });
  it('does not save authentication failures or non-HTML responses', () => {
    expect(cacheShellResponse(new Response('', { status: 401 }), 'a')).toBeNull();
    expect(cacheShellResponse(Response.json({}), 'a')).toBeNull();
  });
});
