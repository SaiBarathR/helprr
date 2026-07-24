import { describe, expect, it } from 'vitest';
import { compareActivityQueueItems, type ActivityQueueSortableItem } from '@/lib/activity-queue-sort';
import { migrateUiPrefs } from '@/lib/store';

const smaller: ActivityQueueSortableItem = {
  title: 'Alpha',
  size: 100,
  sizeleft: 75,
  timeleft: '01:00:00',
};

const larger: ActivityQueueSortableItem = {
  title: 'Beta',
  size: 200,
  sizeleft: 50,
  timeleft: '02:00:00',
};

describe('compareActivityQueueItems', () => {
  it.each(['title', 'progress', 'timeleft', 'size'] as const)(
    'reverses %s ordering when direction changes',
    (sortBy) => {
      const ascending = compareActivityQueueItems(smaller, larger, sortBy, 'asc');
      const descending = compareActivityQueueItems(smaller, larger, sortBy, 'desc');

      expect(Math.sign(descending)).toBe(-Math.sign(ascending));
    },
  );
});

describe('activity sort direction migration', () => {
  it.each([
    ['title', 'asc'],
    ['timeleft', 'asc'],
    ['progress', 'desc'],
    ['size', 'desc'],
  ] as const)('preserves the previous %s ordering', (activitySortBy, expectedDirection) => {
    const migrated = migrateUiPrefs({ activitySortBy }, 43);

    expect(migrated.activitySortDirection).toBe(expectedDirection);
  });
});
