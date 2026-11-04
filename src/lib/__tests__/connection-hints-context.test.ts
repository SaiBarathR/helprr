import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

import { currentHintContext, resetHintContextCache } from '@/lib/connection-hints';

beforeEach(() => {
  resetHintContextCache();
  lookup.mockReset();
  vi.stubEnv('HELPRR_RUNTIME', 'docker');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('currentHintContext', () => {
  it('looks nothing up outside Docker', async () => {
    vi.stubEnv('HELPRR_RUNTIME', '');
    expect(await currentHintContext('http://localhost:8989')).toEqual({ inDocker: false, hostGatewayResolves: false });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('looks nothing up for an address that is not loopback', async () => {
    expect(await currentHintContext('http://192.168.0.124:8989')).toEqual({ inDocker: true, hostGatewayResolves: false });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('reports host.docker.internal when it resolves', async () => {
    lookup.mockResolvedValue({ address: '172.17.0.1', family: 4 });
    expect(await currentHintContext('http://localhost:8989')).toEqual({ inDocker: true, hostGatewayResolves: true });
    expect(lookup).toHaveBeenCalledWith('host.docker.internal');
  });

  it('reports it missing when the lookup fails', async () => {
    lookup.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    expect((await currentHintContext('http://localhost:8989')).hostGatewayResolves).toBe(false);
  });

  it('gives up after a second', async () => {
    vi.useFakeTimers();
    lookup.mockReturnValue(new Promise(() => {}));
    const context = currentHintContext('http://localhost:8989');
    await vi.advanceTimersByTimeAsync(1000);
    expect((await context).hostGatewayResolves).toBe(false);
  });

  it('shares one lookup between parallel callers and reuses it for a minute', async () => {
    vi.useFakeTimers();
    lookup.mockResolvedValue({ address: '172.17.0.1', family: 4 });
    await Promise.all([currentHintContext('http://localhost:1'), currentHintContext('http://127.0.0.1:2')]);
    await currentHintContext('http://localhost:3');
    expect(lookup).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    await currentHintContext('http://localhost:4');
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
