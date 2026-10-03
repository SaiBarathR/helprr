// @vitest-environment jsdom

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecItem } from '@/lib/recommendations/rec-types';
import { useRecEvents, type RecEventTracker } from './use-rec-events';

const item = (n: number) => ({ itemKey: `tmdb:movie:${n}`, genres: [] }) as unknown as RecItem;

let root: Root;
let tracker: RecEventTracker;
const sent: Array<{ events: Array<{ itemKey: string; eventType: string }> }> = [];
let release: (() => void) | null = null;

function Probe({ onReady }: { onReady: (tracker: RecEventTracker) => void }) {
  const events = useRecEvents();
  useEffect(() => onReady(events), [events, onReady]);
  return null;
}

beforeEach(async () => {
  sent.length = 0;
  release = null;
  // The first POST hangs until released, like a slow impressions batch.
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    if (sent.length === 1) return new Promise((resolve) => { release = () => resolve(new Response('{}')); });
    return Promise.resolve(new Response('{}'));
  }));
  const host = document.createElement('div');
  root = createRoot(host);
  await act(async () => root.render(<Probe onReady={(ready) => { tracker = ready; }} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('useRecEvents flush', () => {
  it('waits for a send already in flight, then sends what was queued after it', async () => {
    tracker.impression(item(1), 'top-picks', 0, 'rails');
    const first = tracker.flush();
    tracker.event('not_interested', item(2), 'top-picks', 'rails');

    let settled = false;
    const second = tracker.flush().then(() => { settled = true; });
    await act(async () => { await Promise.resolve(); });
    // The not_interested event is still queued behind the hanging batch.
    expect(settled).toBe(false);
    expect(sent).toHaveLength(1);

    release?.();
    await act(async () => { await Promise.all([first, second]); });
    expect(settled).toBe(true);
    expect(sent.map((batch) => batch.events.map((e) => e.eventType))).toEqual([['impression'], ['not_interested']]);
  });
});
