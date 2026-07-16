import { describe, expect, it } from 'vitest';
import { MAX_EVENTS_PER_BATCH, parseEventsBody } from '@/lib/recommendations/events';

const VALID = {
  itemKey: 'tmdb:movie:603',
  eventType: 'impression',
  railId: 'top-picks',
  context: { position: 3, mode: 'rails', genres: ['Action'], exploration: false },
};

describe('parseEventsBody', () => {
  it('accepts a valid batch', () => {
    const result = parseEventsBody({ events: [VALID, { itemKey: 'anilist:21', eventType: 'like' }] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events).toHaveLength(2);
      expect(result.events[0].context?.position).toBe(3);
    }
  });

  it.each([
    ['not an object', null],
    ['missing events', {}],
    ['empty events', { events: [] }],
    ['oversized batch', { events: Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => VALID) }],
    ['bad itemKey', { events: [{ ...VALID, itemKey: 'movie:603' }] }],
    ['unknown eventType', { events: [{ ...VALID, eventType: 'purchase' }] }],
    ['railId too long', { events: [{ ...VALID, railId: 'x'.repeat(200) }] }],
    ['negative position', { events: [{ ...VALID, context: { position: -1 } }] }],
    ['bad mode', { events: [{ ...VALID, context: { mode: 'push' } }] }],
    ['bad genres', { events: [{ ...VALID, context: { genres: [42] } }] }],
    ['too many genres', { events: [{ ...VALID, context: { genres: Array.from({ length: 11 }, () => 'a') } }] }],
    ['array context', { events: [{ ...VALID, context: [] }] }],
  ])('rejects %s', (_label, body) => {
    expect(parseEventsBody(body).ok).toBe(false);
  });

  it('rejects the whole batch when one entry is malformed', () => {
    const result = parseEventsBody({ events: [VALID, { itemKey: 'nope', eventType: 'click' }] });
    expect(result.ok).toBe(false);
  });
});
