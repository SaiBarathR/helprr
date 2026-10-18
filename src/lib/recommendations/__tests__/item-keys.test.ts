import { describe, expect, it } from 'vitest';
import { isItemKey, jellyfinTitleItemKey } from '@/lib/recommendations/item-keys';

describe('jellyfinTitleItemKey', () => {
  it('keys a film or series by its TMDB id, as the profile builder does', () => {
    expect(jellyfinTitleItemKey({ Id: 'a1', Type: 'Movie', ProviderIds: { Tmdb: '603' } })).toBe('tmdb:movie:603');
    expect(jellyfinTitleItemKey({ Id: 'b2', Type: 'Series', ProviderIds: { Tmdb: '1399' } })).toBe('tmdb:tv:1399');
  });

  it('falls back to the Jellyfin id, which the events API accepts', () => {
    const key = jellyfinTitleItemKey({ Id: '0a1b2c3d-4e5f', Type: 'Movie', ProviderIds: { Imdb: 'tt1' } });
    expect(key).toBe('jf:0a1b2c3d-4e5f');
    expect(isItemKey(key!)).toBe(true);
    expect(jellyfinTitleItemKey({ Id: 'c3', Type: 'Series', ProviderIds: { Tmdb: 'not-a-number' } })).toBe('jf:c3');
  });

  it('has no key for an episode or anything else', () => {
    expect(jellyfinTitleItemKey({ Id: 'e1', Type: 'Episode', ProviderIds: { Tmdb: '5' } })).toBeNull();
    expect(jellyfinTitleItemKey({ Id: 'f1', Type: 'TvChannel' })).toBeNull();
  });
});
