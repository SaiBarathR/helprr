import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock('@/lib/jellyfin-token', () => ({ invalidateJellyfinToken: mocks.invalidate }));

import { jellyfinApiKeyRejectedResponse, jellyfinConnectGateResponse } from '@/lib/api-error';

const rejected = (status: number) => new AxiosError('rejected', 'ERR_BAD_REQUEST', undefined, undefined, {
  status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: null,
});
const user = { id: 'member', jellyfinToken: 'enc:v1:what-this-request-read' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invalidate.mockResolvedValue(undefined);
});

describe('jellyfinConnectGateResponse', () => {
  it.each([401, 403])('drops only the token this request read when Jellyfin answers %i', async (status) => {
    const res = await jellyfinConnectGateResponse(user, rejected(status));
    expect(res?.status).toBe(409);
    expect(mocks.invalidate).toHaveBeenCalledWith('member', 'enc:v1:what-this-request-read');
  });

  it('leaves the token alone for any other failure', async () => {
    expect(await jellyfinConnectGateResponse(user, rejected(500))).toBeNull();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});

describe('jellyfinApiKeyRejectedResponse', () => {
  it('says the server key was refused, as an answer nothing retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = jellyfinApiKeyRejectedResponse(rejected(401));
    expect(res?.status).toBe(409);
    expect(await res?.json()).toEqual({ error: 'jellyfin_api_key_rejected', message: "Jellyfin no longer accepts Helprr's API key." });
  });

  it('leaves every other failure to the caller', () => {
    expect(jellyfinApiKeyRejectedResponse(rejected(403))).toBeNull();
    expect(jellyfinApiKeyRejectedResponse(rejected(500))).toBeNull();
    expect(jellyfinApiKeyRejectedResponse(new Error('ECONNREFUSED'))).toBeNull();
  });
});
