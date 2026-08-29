import { describe, expect, it } from 'vitest';
import { hubRailState } from '@/components/jellyfin-streaming/cinematic/collection-hub';

describe('hubRailState', () => {
  it('shows a loading state before the genre list has arrived', () => {
    // The regression: `rails` is an empty array until the filters query lands,
    // so the old `rails.every(empty) && !rails.some(pending)` test was
    // vacuously true and Shows/Movies flashed "Nothing to show here yet" on
    // every visit.
    expect(hubRailState({
      askedEverything: false,
      railsPending: false,
      hasAnything: false,
      builtRails: 0,
    })).toBe('loading');
  });

  it('stays in the loading state while genre rails are in flight', () => {
    expect(hubRailState({
      askedEverything: true,
      railsPending: true,
      hasAnything: false,
      builtRails: 0,
    })).toBe('loading');
  });

  it('shows what has already resolved rather than covering it with placeholders', () => {
    expect(hubRailState({
      askedEverything: true,
      railsPending: true,
      hasAnything: true,
      builtRails: 0,
    })).toBe('rails');

    expect(hubRailState({
      askedEverything: false,
      railsPending: true,
      hasAnything: false,
      builtRails: 2,
    })).toBe('rails');
  });

  it('only says the library is empty once every question has been answered', () => {
    expect(hubRailState({
      askedEverything: true,
      railsPending: false,
      hasAnything: false,
      builtRails: 0,
    })).toBe('empty');
  });

  it('shows rails when the library answered with content', () => {
    expect(hubRailState({
      askedEverything: true,
      railsPending: false,
      hasAnything: true,
      builtRails: 6,
    })).toBe('rails');
  });
});
