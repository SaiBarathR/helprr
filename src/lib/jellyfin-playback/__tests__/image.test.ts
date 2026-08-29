import { describe, expect, it } from 'vitest';
import {
  jellyfinBackdropUrl,
  jellyfinCardImage,
  jellyfinPersonImageUrl,
} from '@/lib/jellyfin-playback/image';

describe('jellyfinCardImage — landscape frames', () => {
  it('uses an episode still', () => {
    expect(jellyfinCardImage({ Id: 'ep1', Type: 'Episode', ImageTags: { Primary: 't' } }, 400, 'landscape'))
      .toContain('itemId=ep1');
  });

  it('uses a movie thumb so mixed rails stay one height', () => {
    // Continue Watching mixes movies and episodes; a 2:3 movie card among 16:9
    // episode cards left the rail with ragged heights.
    expect(jellyfinCardImage({ Id: 'm1', Type: 'Movie', ImageTags: { Primary: 'p', Thumb: 't' } }, 400, 'landscape'))
      .toContain('type=Thumb');
  });

  it('falls back to the backdrop when there is no thumb', () => {
    expect(jellyfinCardImage(
      { Id: 'm2', Type: 'Movie', ImageTags: { Primary: 'p' }, BackdropImageTags: ['b'] },
      400,
      'landscape',
    )).toContain('type=Backdrop');
  });

  it('accepts poster art as a last resort rather than leaving a hole', () => {
    expect(jellyfinCardImage({ Id: 'm3', Type: 'Movie', ImageTags: { Primary: 'p' } }, 400, 'landscape'))
      .toContain('type=Primary');
  });
});

describe('jellyfinCardImage — portrait frames', () => {
  it('borrows the series poster for an episode instead of cropping the still', () => {
    expect(jellyfinCardImage({ Id: 'ep1', Type: 'Episode', ImageTags: { Primary: 't' }, SeriesId: 's1' }))
      .toContain('itemId=s1');
  });

  it('uses the episode art when there is no parent to borrow from', () => {
    expect(jellyfinCardImage({ Id: 'ep2', Type: 'Episode', ImageTags: { Primary: 't' } }))
      .toContain('itemId=ep2');
  });

  it('uses a movie poster directly', () => {
    expect(jellyfinCardImage({ Id: 'm1', Type: 'Movie', ImageTags: { Primary: 'p' } }))
      .toContain('itemId=m1');
  });

  it('returns null when nothing can supply art', () => {
    expect(jellyfinCardImage({ Id: 'orphan', Type: 'Movie' })).toBeNull();
  });
});

describe('jellyfinPersonImageUrl', () => {
  it('returns null without an image tag, so callers can show a fallback', () => {
    expect(jellyfinPersonImageUrl({ Id: 'person1' })).toBeNull();
  });

  it('returns a url when the person actually has an image', () => {
    expect(jellyfinPersonImageUrl({ Id: 'person1', PrimaryImageTag: 'tag' }))
      .toContain('itemId=person1');
  });

  it('returns null without an id', () => {
    expect(jellyfinPersonImageUrl({ PrimaryImageTag: 'tag' })).toBeNull();
  });
});

describe('jellyfinBackdropUrl', () => {
  it('uses the item backdrop when tagged', () => {
    expect(jellyfinBackdropUrl({ Id: 'a', BackdropImageTags: ['t'] })).toContain('itemId=a');
  });

  it('borrows the series backdrop', () => {
    expect(jellyfinBackdropUrl({ Id: 'a', SeriesId: 's' })).toContain('itemId=s');
  });

  it('returns null rather than a url that is certain to 404', () => {
    expect(jellyfinBackdropUrl({ Id: 'a' })).toBeNull();
  });

  it('honours a narrower width so the hero can mount several layers', () => {
    expect(jellyfinBackdropUrl({ Id: 'a', BackdropImageTags: ['t'] }, 1280)).toContain('maxWidth=1280');
    expect(jellyfinBackdropUrl({ Id: 'a', BackdropImageTags: ['t'] })).toContain('maxWidth=1920');
  });
});
