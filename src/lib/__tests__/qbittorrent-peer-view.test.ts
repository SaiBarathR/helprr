import { describe, expect, it } from 'vitest';
import { countryFlag, mergePeers, sortPeers, type PeersDelta } from '@/lib/qbittorrent-peer-view';

const delta = (over: Partial<PeersDelta>): PeersDelta => ({ rid: 1, fullUpdate: false, showFlags: null, peers: {}, removed: [], ...over });

describe('mergePeers', () => {
  it('replaces the list on a full update', () => {
    const first = mergePeers(undefined, delta({ fullUpdate: true, showFlags: true, peers: { a: { client: 'A' }, b: { client: 'B' } } }));
    const next = mergePeers(first, delta({ rid: 2, fullUpdate: true, peers: { c: { client: 'C' } } }));
    expect(next).toEqual({ rid: 2, showFlags: true, peers: { c: { client: 'C' } } });
  });

  it('merges changed fields, adds new peers and drops departed ones', () => {
    const first = mergePeers(undefined, delta({ fullUpdate: true, showFlags: false, peers: { a: { client: 'A', dl_speed: 1 }, b: { client: 'B' } } }));
    const next = mergePeers(first, delta({ rid: 2, peers: { a: { dl_speed: 5 }, c: { client: 'C' } }, removed: ['b'] }));
    expect(next).toEqual({ rid: 2, showFlags: false, peers: { a: { client: 'A', dl_speed: 5 }, c: { client: 'C' } } });
    // The earlier state is left as it was.
    expect(first.peers.a.dl_speed).toBe(1);
  });
});

describe('sortPeers', () => {
  const peers = { k1: { dl_speed: 1, client: 'b' }, k2: { dl_speed: 9, client: '' }, k3: { dl_speed: 1, client: 'a' } };

  it('puts the fastest first and keeps ties in key order', () => {
    expect(sortPeers(peers, 'dl_speed').map(([key]) => key)).toEqual(['k2', 'k1', 'k3']);
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
