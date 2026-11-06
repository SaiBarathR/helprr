import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '../sw-register';

const withContainer = (container: unknown) => vi.stubGlobal('navigator', { serviceWorker: container });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('registerServiceWorker', () => {
  it('registers the development push worker outside production', async () => {
    const register = vi.fn(async () => ({}));
    withContainer({ register });
    await registerServiceWorker();
    expect(register).toHaveBeenCalledWith('/sw-push.js');
  });

  it('does nothing where the browser has no service worker container', async () => {
    withContainer(undefined);
    await expect(registerServiceWorker()).resolves.toBeUndefined();
  });

  it('settles quietly when reading the container throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('navigator', {
      get serviceWorker() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
    });
    await expect(registerServiceWorker()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['rejects', 1, () => Promise.reject(new DOMException('The operation is insecure.', 'SecurityError'))],
    ['throws', 1, () => { throw new TypeError('register is not available'); }],
    ['resolves to nothing', 0, async () => undefined],
  ])('settles quietly when register() %s', async (_label, warnings, register) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withContainer({ register });
    await expect(registerServiceWorker()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(warnings);
  });
});
