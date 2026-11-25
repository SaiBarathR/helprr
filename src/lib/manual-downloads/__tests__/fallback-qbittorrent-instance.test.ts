import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * QBT-29: a fallback download's torrent is in one of Helprr's qBittorrents,
 * found by its hash. Two that list it can't be told apart, and before the
 * torrent is changed one that did not answer may be holding it too.
 */
const mocks = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/service-helpers', () => ({ findQBittorrentsWithTorrent: mocks.find }));

import { fallbackTorrentHome } from '../fallback';

const at = (id: string) => ({ connection: { id, url: `http://${id}:8080` }, client: { id }, torrent: { hash: 'abc' } });

beforeEach(() => {
  mocks.find.mockReset();
});

describe('fallbackTorrentHome', () => {
  it('is the one qBittorrent that lists the torrent', async () => {
    mocks.find.mockResolvedValue({ found: [at('q2')], failed: 0 });
    expect(await fallbackTorrentHome('ABC', true)).toEqual(expect.objectContaining({ ok: true, connection: { id: 'q2', url: 'http://q2:8080' } }));
    expect(mocks.find).toHaveBeenCalledWith('ABC');
  });

  it('refuses when two list it, whether or not it is about to be changed', async () => {
    mocks.find.mockResolvedValue({ found: [at('q1'), at('q2')], failed: 0 });
    expect(await fallbackTorrentHome('ABC', false)).toEqual({ ok: false, reason: 'ambiguous' });
    expect(await fallbackTorrentHome('ABC', true)).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('reads from the one found while another does not answer, but changes nothing then', async () => {
    mocks.find.mockResolvedValue({ found: [at('q1')], failed: 1 });
    expect((await fallbackTorrentHome('ABC', false)).ok).toBe(true);
    expect(await fallbackTorrentHome('ABC', true)).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('tells a torrent that is gone from one that could not be looked for', async () => {
    mocks.find.mockResolvedValue({ found: [], failed: 0 });
    expect(await fallbackTorrentHome('ABC', true)).toEqual({ ok: false, reason: 'missing' });
    mocks.find.mockResolvedValue({ found: [], failed: 1 });
    expect(await fallbackTorrentHome('ABC', true)).toEqual({ ok: false, reason: 'unreachable' });
    mocks.find.mockImplementation(async () => { throw new Error('not configured'); });
    expect(await fallbackTorrentHome('ABC', true)).toEqual({ ok: false, reason: 'unreachable' });
  });
});
