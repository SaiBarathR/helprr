import { describe, expect, it } from 'vitest';
import { migrateUiPrefs } from '@/lib/store';

describe('the feed view', () => {
  it('moves a saved grid or list to grouped once, because grouped became the default', () => {
    expect(migrateUiPrefs({ twitchFeedView: 'grid', youtubeFeedView: 'list' }, 48)).toMatchObject({ twitchFeedView: 'grouped', youtubeFeedView: 'grouped' });
  });

  it('keeps a choice made after that', () => {
    expect(migrateUiPrefs({ twitchFeedView: 'list', youtubeFeedView: 'grid' }, 49)).toMatchObject({ twitchFeedView: 'list', youtubeFeedView: 'grid' });
  });

  it('adds nothing a partial import never had', () => {
    expect(migrateUiPrefs({ torrentsView: 'table' }, 48)).not.toHaveProperty('twitchFeedView');
  });
});

describe('the library view', () => {
  it('starts grouped, and travels with the other view settings', async () => {
    const { useUIStore } = await import('@/lib/store');
    const { UI_PREF_CATEGORY_FIELDS } = await import('@/lib/settings-export');
    expect(useUIStore.getState()).toMatchObject({ twitchLibraryView: 'grouped', youtubeLibraryView: 'grouped' });
    expect(UI_PREF_CATEGORY_FIELDS.mediaViews).toEqual(expect.arrayContaining(['twitchLibraryView', 'youtubeLibraryView']));
  });
});
