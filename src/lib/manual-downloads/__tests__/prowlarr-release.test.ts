import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    prowlarr: { fetchReleaseLink: vi.fn() },
    getProwlarrClient: vi.fn(),
    redis: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => { store.set(key, value); return 'OK'; }),
      multi: vi.fn(() => {
        const batch = {
          set: vi.fn((key: string, value: string) => { store.set(key, value); return batch; }),
          exec: vi.fn(async () => []),
        };
        return batch;
      }),
    },
  };
});
vi.mock('@/lib/redis', () => ({ getRedisClient: vi.fn(async () => mocks.redis) }));
vi.mock('@/lib/service-helpers', () => ({ getProwlarrClient: mocks.getProwlarrClient }));

import { issueReleaseTokens, PROWLARR_SCOPE } from '@/lib/release-tokens';
import { prowlarrReleaseSource } from '../prowlarr-release';
import { ManualDownloadRequestError } from '../request';

const SECRET = 'S3cretProwlarrKey0123456789';
const HASH = '382cc016ff22946008ecddcb0dda820f42b0cd5a';
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Big.Buck.Bunny.2008.720p&tr=https://tracker.example/${SECRET}/announce`;
const MAGNET_LINK = `http://prowlarr:9696/6/download?apikey=${SECRET}&link=m&file=Bunny`;
const TORRENT_LINK = `http://prowlarr:9696/6/download?apikey=${SECRET}&link=t&file=Bunny`;

function torrent(name: string): Buffer {
  const info = Buffer.concat([Buffer.from(`d6:lengthi1e4:name${name.length}:${name}12:piece lengthi16384e6:pieces20:`), Buffer.alloc(20, 1), Buffer.from('e')]);
  return Buffer.concat([Buffer.from('d4:info'), info, Buffer.from('e')]);
}

async function token(release: Record<string, unknown>, userId = 'u1'): Promise<string> {
  const [issued] = await issueReleaseTokens(PROWLARR_SCOPE, userId, [{ guid: 'g1', indexerId: 6, ...release }]);
  return issued;
}

const failed = (status: number) => new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
  status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: `error at ${TORRENT_LINK}`,
});

async function refusal(promise: Promise<unknown>): Promise<ManualDownloadRequestError> {
  const error = await promise.catch((caught) => caught);
  expect(error).toBeInstanceOf(ManualDownloadRequestError);
  return error as ManualDownloadRequestError;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.clear();
  mocks.getProwlarrClient.mockResolvedValue(mocks.prowlarr);
});

describe('prowlarrReleaseSource', () => {
  it('reads the magnet through Prowlarr first, and keeps it for the Send that follows a Check', async () => {
    const id = await token({ protocol: 'torrent', magnetUrl: MAGNET_LINK, downloadUrl: TORRENT_LINK });
    mocks.prowlarr.fetchReleaseLink.mockResolvedValue({ kind: 'MAGNET', magnetUrl: MAGNET });

    const first = await prowlarrReleaseSource('u1', id);
    const again = await prowlarrReleaseSource('u1', id);

    expect(first).toEqual({ kind: 'MAGNET', infoHash: HASH.toUpperCase(), name: 'Big.Buck.Bunny.2008.720p', magnetUrl: MAGNET });
    expect(again).toEqual(first);
    expect(mocks.prowlarr.fetchReleaseLink).toHaveBeenCalledTimes(1);
    expect(mocks.prowlarr.fetchReleaseLink).toHaveBeenCalledWith(MAGNET_LINK);
  });

  it('falls back to the .torrent when the magnet link fails', async () => {
    const id = await token({ protocol: 'torrent', magnetUrl: MAGNET_LINK, downloadUrl: TORRENT_LINK });
    mocks.prowlarr.fetchReleaseLink
      .mockRejectedValueOnce(failed(500))
      .mockResolvedValueOnce({ kind: 'TORRENT_FILE', bytes: torrent('Bunny.mkv') });

    const source = await prowlarrReleaseSource('u1', id);

    expect(source).toEqual(expect.objectContaining({ kind: 'TORRENT_FILE', name: 'Bunny.mkv' }));
    expect(mocks.prowlarr.fetchReleaseLink.mock.calls).toEqual([[MAGNET_LINK], [TORRENT_LINK]]);
  });

  it('treats a missing, expired or another user\'s token as expired, before asking Prowlarr', async () => {
    const id = await token({ protocol: 'torrent', magnetUrl: MAGNET_LINK }, 'someone-else');

    expect((await refusal(prowlarrReleaseSource('u1', id))).status).toBe(410);
    expect((await refusal(prowlarrReleaseSource('u1', 'no-such-token'))).status).toBe(410);
    expect(mocks.getProwlarrClient).not.toHaveBeenCalled();
  });

  it('refuses a Usenet release without asking Prowlarr', async () => {
    const id = await token({ protocol: 'usenet', downloadUrl: TORRENT_LINK });

    const error = await refusal(prowlarrReleaseSource('u1', id));

    expect(error.status).toBe(400);
    expect(error.message).toMatch(/Only torrent releases/);
    expect(mocks.prowlarr.fetchReleaseLink).not.toHaveBeenCalled();
  });

  it('says why when every link fails, quoting no link', async () => {
    const id = await token({ protocol: 'torrent', magnetUrl: MAGNET_LINK, downloadUrl: TORRENT_LINK });
    mocks.prowlarr.fetchReleaseLink.mockRejectedValue(failed(429));

    const error = await refusal(prowlarrReleaseSource('u1', id));

    expect(error.status).toBe(502);
    expect(error.message).toMatch(/limiting requests/);
    expect(error.message).not.toContain(SECRET);
    expect(mocks.store.size).toBe(1); // only the token: nothing was kept
  });

  it('passes on what is wrong with the torrent Prowlarr handed back', async () => {
    const id = await token({ protocol: 'torrent', downloadUrl: TORRENT_LINK });
    mocks.prowlarr.fetchReleaseLink.mockResolvedValue({ kind: 'TORRENT_FILE', bytes: Buffer.from('<html>login</html>') });

    expect((await refusal(prowlarrReleaseSource('u1', id))).message).toBe('This is not a valid .torrent file.');
  });

  it('says so when the release has no link, or Prowlarr is not connected', async () => {
    expect((await refusal(prowlarrReleaseSource('u1', await token({ protocol: 'torrent' })))).message).toMatch(/no download link/);

    mocks.getProwlarrClient.mockRejectedValue(new Error('Prowlarr is not configured.'));
    expect((await refusal(prowlarrReleaseSource('u1', await token({ protocol: 'torrent', magnetUrl: MAGNET_LINK })))).status).toBe(409);
  });
});
