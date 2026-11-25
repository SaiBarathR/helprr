import { describe, expect, it } from 'vitest';
import { countryFlag, mergePeers, sortPeers, type PeersDelta } from '@/lib/qbittorrent-peer-view';

const delta = (over: Partial<PeersDelta>): PeersDelta => ({ cursor: 'c1', fullUpdate: false, showFlags: null, peers: {}, removed: [], ...over });

describe('mergePeers', () => {
  it('replaces the list on a full update', () => {
    const first = mergePeers(undefined, delta({ fullUpdate: true, showFlags: true, peers: { a: { client: 'A' }, b: { client: 'B' } } }));
    const next = mergePeers(first, delta({ cursor: 'c2', fullUpdate: true, showFlags: true, peers: { c: { client: 'C' } } }));
    expect(next).toEqual({ cursor: 'c2', showFlags: true, peers: { c: { client: 'C' } }, private: null });
  });

  it('merges changed fields, adds new peers and drops departed ones', () => {
    const first = mergePeers(undefined, delta({ fullUpdate: true, showFlags: false, private: true, peers: { a: { client: 'A', dl_speed: 1 }, b: { client: 'B' } } }));
    const next = mergePeers(first, delta({ cursor: 'c2', showFlags: false, peers: { a: { dl_speed: 5 }, c: { client: 'C' } }, removed: ['b'] }));
    // `private` comes with the first answer only and is kept.
    expect(next).toEqual({ cursor: 'c2', showFlags: false, private: true, peers: { a: { client: 'A', dl_speed: 5 }, c: { client: 'C' } } });
    // The earlier state is left as it was.
    expect(first.peers.a.dl_speed).toBe(1);
  });
});

describe('sortPeers', () => {
  const peers = { k1: { dl_speed: 1, client: 'b' }, k2: { dl_speed: 9, client: '' }, k3: { dl_speed: 1, client: 'a' } };

  it('puts the fastest first and keeps ties in key order', () => {
    expect(sortPeers(peers, 'dl_speed').map(([key]) => key)).toEqual(['k2', 'k1', 'k3']);
  });

  it('keeps the order shown while rates swing between polls, and moves a peer that is twice as fast', () => {
    const keys = (rows: Array<[string, unknown]>) => rows.map(([key]) => key);
    // First poll: sorted exactly.
    const first = keys(sortPeers({ k1: { dl_speed: 10_800 }, k2: { dl_speed: 8_900 }, k3: { dl_speed: 68_000 }, k4: { dl_speed: 0 } }, 'dl_speed'));
    expect(first).toEqual(['k3', 'k1', 'k2', 'k4']);
    // 8.9 and 10.8 KB/s swapped places on each refresh; within a factor of two they keep their places.
    const later = { k1: { dl_speed: 9_100 }, k2: { dl_speed: 10_900 }, k3: { dl_speed: 71_000 }, k4: { dl_speed: 0 }, k5: { dl_speed: 5_000 } };
    expect(keys(sortPeers(later, 'dl_speed'))).toEqual(['k3', 'k2', 'k1', 'k5', 'k4']);
    const second = keys(sortPeers(later, 'dl_speed', first));
    // A new peer starts at the end and rises past the much slower one; a gone one drops out.
    expect(second).toEqual(['k3', 'k1', 'k2', 'k5', 'k4']);
    expect(keys(sortPeers({ k1: { dl_speed: 9_000 }, k2: { dl_speed: 30_000 }, k3: { dl_speed: 70_000 } }, 'dl_speed', second))).toEqual(['k3', 'k2', 'k1']);
    // Other sorts are always exact.
    expect(keys(sortPeers({ k1: { progress: 0.2 }, k2: { progress: 0.3 } }, 'progress', ['k1', 'k2']))).toEqual(['k2', 'k1']);
  });

  it('sorts names A to Z with unknown ones last', () => {
    expect(sortPeers(peers, 'client').map(([key]) => key)).toEqual(['k3', 'k1', 'k2']);
  });
});

describe('countryFlag', () => {
  it('turns a two-letter code into its flag', () => {
    expect(countryFlag('ca')).toBe('🇨🇦');
    expect(countryFlag('GB')).toBe('🇬🇧');
  });

  it.each([undefined, '', 'usa', '1a'])('has none for %j', (code) => {
    expect(countryFlag(code)).toBe('');
  });
});
