import { afterEach, describe, expect, it, vi } from 'vitest';
import { NetworkOnly } from 'serwist';
import { rejectionLogLevel } from '@/lib/sw-rejection-log-level';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('rejectionLogLevel', () => {
  it("logs Serwist's no-response rejection at debug", async () => {
    class WorkerEvent {
      waitUntil() {}
    }
    // Serwist's development-only logging needs a worker console; production skips it.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('FetchEvent', WorkerEvent);
    vi.stubGlobal('ExtendableEvent', WorkerEvent);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    const reason = await new NetworkOnly()
      .handle({ request: new Request('https://helprr.test/api/x'), event: new WorkerEvent() as never })
      .catch((error: unknown) => error);
    expect((reason as Error).name).toBe('no-response');
    expect(rejectionLogLevel(reason)).toBe('debug');
  });

  it.each([
    ['a TypeError', new TypeError('Failed to fetch')],
    ['another Serwist error', Object.assign(new Error('x'), { name: 'invalid-value' })],
    ['a plain object named no-response', { name: 'no-response' }],
    ['a string', 'no-response'],
    ['undefined', undefined],
  ])('keeps %s at error', (_label, reason) => {
    expect(rejectionLogLevel(reason)).toBe('error');
  });
});
