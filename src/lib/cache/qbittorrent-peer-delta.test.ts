import { describe, expect, it } from 'vitest';
import { PeerDeltaHistory, type PeerList } from '@/lib/cache/qbittorrent-peer-delta';
import type { PeerView } from '@/lib/qbittorrent-peer-view';

const peer = (over: Partial<PeerView> = {}): PeerView => ({
  client: 'A', peer_id_client: '-A-', connection: 'BT', flags: 'D', flags_desc: '', progress: 0, relevance: 1,
  dl_speed: 0, up_speed: 0, downloaded: 0, uploaded: 0, ...over,
});
const list = (peers: Record<string, PeerView>, showFlags: boolean | null = true): PeerList => ({ showFlags, peers });

describe('PeerDeltaHistory', () => {
  it('sends the full list first, then only what changed since the cursor', () => {
    const history = new PeerDeltaHistory();
    const first = history.response('u:h', undefined, list({ a: peer(), b: peer() }));
    expect(first).toMatchObject({ fullUpdate: true, removed: [] });
    const next = history.response('u:h', first.cursor, list({ a: peer({ dl_speed: 5 }), c: peer({ client: 'C' }) }));
    expect(next).toMatchObject({ fullUpdate: false, peers: { a: { dl_speed: 5 }, c: peer({ client: 'C' }) }, removed: ['b'] });
    // Nothing changed: an empty delta.
    const same = history.response('u:h', next.cursor, list({ a: peer({ dl_speed: 5 }), c: peer({ client: 'C' }) }));
    expect(same).toMatchObject({ fullUpdate: false, peers: {}, removed: [] });
  });

  it('starts over for a cursor from another scope, an unknown or an expired one', () => {
    const history = new PeerDeltaHistory();
    const first = history.response('u:h1', undefined, list({ a: peer() }), 0);
    expect(history.response('u:h2', first.cursor, list({ b: peer() }), 1).fullUpdate).toBe(true);
    expect(history.response('u:h1', 'nope', list({ a: peer() }), 2).fullUpdate).toBe(true);
    const fresh = history.response('u:h1', undefined, list({ a: peer() }), 3);
    expect(history.response('u:h1', fresh.cursor, list({ a: peer() }), 3 + 121_000).fullUpdate).toBe(true);
  });

  it('starts over when qBittorrent starts or stops resolving countries', () => {
    const history = new PeerDeltaHistory();
    const first = history.response('u:h', undefined, list({ a: peer({ country: 'Canada' }) }, true));
    expect(history.response('u:h', first.cursor, list({ a: peer() }, false)).fullUpdate).toBe(true);
  });

  it('keeps two pollers of one torrent apart: each diffs against the list it was sent', () => {
    const history = new PeerDeltaHistory();
    const one = history.response('u:h', undefined, list({ a: peer() }));
    const two = history.response('u:h', undefined, list({ a: peer(), b: peer() }));
    expect(history.response('u:h', one.cursor, list({ a: peer(), b: peer() })).peers).toEqual({ b: peer() });
    expect(history.response('u:h', two.cursor, list({ a: peer() })).removed).toEqual(['b']);
  });
});
