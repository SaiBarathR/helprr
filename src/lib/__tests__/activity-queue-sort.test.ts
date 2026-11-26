import { describe, expect, it } from 'vitest';
import {
  compareActivityQueueItems,
  getDefaultActivitySortDirection,
  type ActivityQueueSortableItem,
} from '@/lib/activity-queue-sort';
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

describe('time left ordering', () => {
  const item = (title: string, timeleft?: string): ActivityQueueSortableItem => ({ title, size: 1, sizeleft: 1, timeleft });

  it('sorts by the duration, not the TimeSpan text; unknown last', () => {
    const items = [
      item('none'),
      item('held long', '1970.04:10:55.0718460'),
      item('held short', '694.01:41:34.0723369'),
      item('hours', '02:00:00'),
      item('minutes', '00:09:00'),
    ];
    const ascending = [...items].sort((a, b) => compareActivityQueueItems(a, b, 'timeleft', 'asc'));
    expect(ascending.map((i) => i.title)).toEqual(['minutes', 'hours', 'held short', 'held long', 'none']);
  });
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

describe('getDefaultActivitySortDirection', () => {
  it.each([
    ['title', 'asc'],
    ['timeleft', 'asc'],
    ['progress', 'desc'],
    ['size', 'desc'],
  ] as const)('defaults %s to %s', (sortBy, expectedDirection) => {
    expect(getDefaultActivitySortDirection(sortBy)).toBe(expectedDirection);
  });
});
